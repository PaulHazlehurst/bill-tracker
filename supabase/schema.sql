-- Run this in the Supabase SQL editor (or `supabase db push`).
-- The browser talks to Postgres directly via the anon key; Row Level
-- Security below is what keeps that safe, not application code.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  logo_url text,
  -- Shareable code so joining a team requires actually knowing it, instead
  -- of anyone being able to pick any team name off an open list at signup -
  -- that used to be possible and was a real access-control gap, not just a
  -- style choice.
  invite_code text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  -- Whoever created the team. The only permission tier this schema has -
  -- there's no broader "admin" role, just "owner vs. everyone else" - used
  -- to gate renaming the team, regenerating the invite code, and removing
  -- members. See the trigger below for how this is actually enforced.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One row per auth user. Extends Supabase's built-in auth.users.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  phone text,                       -- E.164, e.g. +14105551234; nullable, opt-in
  organization_id uuid references organizations(id) on delete set null,
  -- Applied to newly tracked bills so people don't have to re-toggle these
  -- every single time - purely a convenience default, editable per-bill after.
  default_notify_email boolean not null default true,
  default_notify_sms boolean not null default false,
  -- Master opt-in gate. Even if a tracked_bills row has notify_email = true,
  -- no email actually goes out unless this is also true - a real "I want to
  -- receive email from this app" decision, not just an inherited default.
  -- Off by default: no one should get an email before deliberately asking for it.
  email_notifications_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Local cache/snapshot of congress.gov data - what the poller diffs against.
create table bills (
  id text primary key,              -- e.g. "hr-1234-119"
  congress integer not null,
  bill_type text not null,
  bill_number integer not null,
  title text not null,
  latest_action text,
  latest_action_date date,
  status_stage text not null default 'introduced',
  progress_pct integer not null default 10,
  congress_url text,
  raw_snapshot jsonb,
  last_polled_at timestamptz,
  next_poll_at timestamptz not null default now(),
  poll_priority text not null default 'normal',   -- 'hot' | 'normal' | 'dormant'
  -- Related bills and the full action/vote history are each a SEPARATE
  -- congress.gov API call beyond the main bill fetch. Fetching them for
  -- every tracked bill during the daily poll would multiply our request
  -- volume for data most people never look at. Instead these are fetched
  -- ON DEMAND (when someone actually opens the bill detail page's Related
  -- Bills / Votes & Actions sections) and cached here, refreshed only when
  -- stale - see /api/bills/related and /api/bills/actions.
  related_bills jsonb,
  related_bills_fetched_at timestamptz,
  actions_cache jsonb,
  actions_fetched_at timestamptz,
  -- Cosponsor party breakdown (e.g. {"D": 12, "R": 8, "I": 1}) - same
  -- on-demand-and-cached pattern as related_bills/actions_cache above.
  cosponsor_breakdown jsonb,
  cosponsor_breakdown_fetched_at timestamptz,
  -- Committee/hearing activity: dated history (e.g. "Hearings by X Committee
  -- on 2025-04-02") straight from the bill's own committee record - reliable,
  -- official, cheap.
  committee_activity jsonb,
  committee_activity_fetched_at timestamptz,
  -- Richer hearing detail (witnesses, meeting documents, video) - only
  -- populated for hearings we could confidently match to a specific
  -- committee-meeting record (matched by that record actually listing this
  -- bill, not by guessing from committee name/date alone). Some hearings
  -- won't have a confident match, and that's disclosed rather than guessed at.
  hearing_details jsonb,
  hearing_details_fetched_at timestamptz,
  -- Official CRS-authored plain-language summaries.
  summaries jsonb,
  summaries_fetched_at timestamptz,
  -- Lobbying filings (LDA.gov) whose issue text appears to mention this
  -- bill - best-effort text match, not a guaranteed-complete list. See
  -- lib/lda-api.ts for the honesty note on why.
  lobbying_activity jsonb,
  lobbying_activity_fetched_at timestamptz,
  -- Congressional Record mentions (GovInfo Search Service, "public
  -- preview" per their own docs) - floor speeches/remarks about this bill.
  congressional_record_mentions jsonb,
  congressional_record_mentions_fetched_at timestamptz,
  -- The actual legislative text versions (Introduced, Reported, etc.) with
  -- links to each format - not the plain-language CRS summary.
  text_versions jsonb,
  text_versions_fetched_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Generated when the poller detects a real change - the "event" that
-- drives notifications.
create table bill_events (
  id uuid primary key default gen_random_uuid(),
  bill_id text not null references bills(id) on delete cascade,
  event_type text not null,         -- status_change | new_action | cosponsor_change
  summary text not null,
  occurred_at timestamptz not null default now(),
  notified_at timestamptz,
  -- Structured delta for cosponsor_change events specifically - powers the
  -- Trending Bills widget. Parsing this back out of the free-text summary
  -- would be fragile; this is set directly by the poller instead.
  cosponsor_delta integer
);

-- Join table: who's tracking which bill. organization_id is captured at
-- insert time for reference/analytics only - it is NOT used to determine
-- team visibility (see the RLS policies below, which check the tracker's
-- CURRENT organization live via public.user_org_id()). Relying on this
-- column for access control was a real bug: it goes stale the moment
-- someone changes teams, silently hiding their bills from teammates.
create table tracked_bills (
  id uuid primary key default gen_random_uuid(),
  bill_id text not null references bills(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  notify_email boolean not null default true,
  notify_sms boolean not null default false,
  position text not null default 'none' check (position in ('support', 'oppose', 'watching', 'none')),
  created_at timestamptz not null default now(),
  unique (bill_id, user_id)
);

create index on tracked_bills (bill_id);
create index on tracked_bills (user_id);
create index on tracked_bills (organization_id);
create index on bills (next_poll_at);
create index on bill_events (bill_id);

-- ── Row Level Security ──────────────────────────────────────────────

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table bills enable row level security;
alter table bill_events enable row level security;
alter table tracked_bills enable row level security;

-- Organizations: publicly readable (even by signed-out visitors) so the
-- signup page's organization dropdown works before an account exists.
-- Org names aren't sensitive, so this is a deliberate, safe simplification.
create policy "orgs are publicly readable"
  on organizations for select
  using (true);

create policy "authenticated users can create an organization"
  on organizations for insert
  with check (auth.role() = 'authenticated');

-- Any current member can attempt an update (needed so any member can
-- upload a logo) - but the trigger below is what actually decides whether
-- a given change is allowed, field by field. RLS alone can't express
-- "anyone may change logo_url, but only the owner may change name" since
-- Postgres row policies don't see individual column changes - a trigger can.
create policy "org members can attempt organization updates"
  on organizations for update
  using (id = public.current_user_org_id())
  with check (id = public.current_user_org_id());

-- Enforces: any member may change the logo. Changing anything else (name,
-- invite_code, created_by) requires being the team's owner. Raises an
-- exception for a disallowed change, which surfaces to the client as a
-- normal Postgres error - this is real enforcement, not just a UI choice
-- to hide the rename button from non-owners.
create or replace function public.enforce_org_update_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  only_logo_changed boolean;
begin
  only_logo_changed :=
    (new.name is not distinct from old.name)
    and (new.invite_code is not distinct from old.invite_code)
    and (new.created_by is not distinct from old.created_by);

  if only_logo_changed then
    if public.current_user_org_id() is distinct from old.id then
      raise exception 'not a member of this organization';
    end if;
  else
    if old.created_by is distinct from auth.uid() then
      raise exception 'only the team owner can change that';
    end if;
  end if;

  return new;
end;
$$;

create trigger org_update_permission_check
  before update on organizations
  for each row execute function public.enforce_org_update_permissions();

-- ── Storage: organization logos ─────────────────────────────────────
-- A public bucket for team logos. Logos aren't sensitive, so reads are
-- public; uploads/replaces require being signed in. There's no per-org path
-- restriction on write access (any authenticated user could technically
-- overwrite another org's logo file) - acceptable for now since the app has
-- no adversarial multi-tenant threat model yet, but worth tightening with a
-- path-prefix check if that ever changes.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

create policy "org logos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'org-logos');

create policy "authenticated users can upload org logos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'org-logos');

create policy "authenticated users can replace org logos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'org-logos')
  with check (bucket_id = 'org-logos');

-- Looks up the signed-in user's organization_id WITHOUT going through RLS
-- on profiles. Needed because two policies below need this value while
-- themselves being evaluated as part of profiles/tracked_bills RLS checks -
-- a plain subquery there would re-trigger the same policy checking itself,
-- which Postgres detects as infinite recursion. SECURITY DEFINER runs this
-- with the function owner's privileges, bypassing RLS just for this lookup.
create or replace function public.current_user_org_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

-- Same idea as above, but for looking up ANY user's current organization,
-- not just the caller's. Used below so team visibility is computed live
-- from each tracker's current profile, instead of a value copied onto
-- tracked_bills at the moment they tracked it (which goes stale the
-- instant that person changes teams, and silently hides their bills from
-- teammates with no error anywhere - this was a real bug, not theoretical).
create or replace function public.user_org_id(target_user uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id from public.profiles where id = target_user
$$;

-- Profiles: read your own; read teammates' (needed for the team page's
-- "who's tracking this" list) but note this table has no notify prefs in it,
-- so teammates' phone numbers are the only sensitive field exposed here -
-- consider dropping `phone` from any client select on this table if that's
-- too much, and fetching it server-side only where actually needed (cron notify).
create policy "users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "users can view teammates' profiles"
  on profiles for select
  using (
    organization_id is not null
    and organization_id = public.current_user_org_id()
  );

create policy "users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

create policy "users can insert their own profile"
  on profiles for insert
  with check (auth.uid() = id);

-- Bills and bill_events: public congressional data, readable by anyone signed in.
create policy "bills readable by authenticated users"
  on bills for select
  using (auth.role() = 'authenticated');

-- Any signed-in user can cache a new bill (this is what happens the first
-- time anyone tracks a bill that isn't already in the local database).
-- Safe to allow broadly since this is just public congress.gov data.
create policy "authenticated users can cache new bills"
  on bills for insert
  with check (auth.role() = 'authenticated');

create policy "bill events readable by authenticated users"
  on bill_events for select
  using (auth.role() = 'authenticated');

-- Tracked bills: see your own personal tracking...
create policy "users can view their own tracked bills"
  on tracked_bills for select
  using (auth.uid() = user_id);

-- ...and everything your whole team is CURRENTLY tracking - computed live
-- from each tracker's present-day organization, not from whatever was
-- copied onto the row when they tracked it.
create policy "users can view their team's tracked bills"
  on tracked_bills for select
  using (
    public.current_user_org_id() is not null
    and public.user_org_id(user_id) = public.current_user_org_id()
  );

create policy "users can track bills for themselves"
  on tracked_bills for insert
  with check (auth.uid() = user_id);

create policy "users can update their own tracked bills"
  on tracked_bills for update
  using (auth.uid() = user_id);

create policy "users can delete their own tracked bills"
  on tracked_bills for delete
  using (auth.uid() = user_id);

-- Seed a couple of organizations to start.
insert into organizations (name) values ('Example Advocacy Group');

-- API usage tracking - powers the API Usage page. Only ever written/read
-- via the admin client (see lib/apiUsageTracker.ts and
-- app/api/admin/api-usage/route.ts), so RLS is enabled with no policies:
-- nobody can touch these through the anon/session key at all.
create table api_call_log (
  id bigserial primary key,
  service text not null,
  called_at timestamptz not null default now()
);
alter table api_call_log enable row level security;

create table api_rate_limit_snapshot (
  service text primary key,
  limit_value integer,
  remaining_value integer,
  updated_at timestamptz not null default now()
);
alter table api_rate_limit_snapshot enable row level security;

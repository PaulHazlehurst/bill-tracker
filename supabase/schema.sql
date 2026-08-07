-- Run this in the Supabase SQL editor (or `supabase db push`).
-- The browser talks to Postgres directly via the anon key; Row Level
-- Security below is what keeps that safe, not application code.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  logo_url text,
  created_at timestamptz not null default now()
);

-- One row per auth user. Extends Supabase's built-in auth.users.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  phone text,                       -- E.164, e.g. +14105551234; nullable, opt-in
  organization_id uuid references organizations(id) on delete set null,
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
  updated_at timestamptz not null default now()
);

-- Generated when the poller detects a real change - the "event" that
-- drives notifications.
create table bill_events (
  id uuid primary key default gen_random_uuid(),
  bill_id text not null references bills(id) on delete cascade,
  event_type text not null,         -- status_change | new_action
  summary text not null,
  occurred_at timestamptz not null default now(),
  notified_at timestamptz
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

-- Any member of an org can update its shared settings (currently just the
-- logo) - there's no separate "admin" role in this schema, membership is
-- the only permission tier, matching the rest of this app's team-shared model.
create policy "org members can update their organization"
  on organizations for update
  using (id = public.current_user_org_id())
  with check (id = public.current_user_org_id());

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

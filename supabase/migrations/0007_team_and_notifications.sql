-- 0007: Teams with admins and email invitations, notifications (the bell
-- and push to phones and computers), and tighter team security.
--
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.
--
-- Security fixes in here, worth knowing about:
--  * Teams used to be readable by anyone, including each team's invite code,
--    so in principle anyone could find a code and join any team. Now only a
--    team's own members can see it.
--  * People could move their own account into any team by editing their
--    profile directly. Joining now only happens through an invitation or a
--    valid invite code, checked on the server.

-- ── People: names, roles, notification choice ───────────────────────
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists team_role text not null default 'member';
alter table public.profiles drop constraint if exists profiles_team_role_check;
alter table public.profiles add constraint profiles_team_role_check check (team_role in ('admin', 'member'));
-- Push alerts for the bills someone follows, on every device they've turned push on.
alter table public.profiles add column if not exists notify_push boolean not null default true;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Whoever created a team is its first admin.
update public.profiles p set team_role = 'admin'
  from public.organizations o
 where o.id = p.organization_id and o.created_by = p.id and p.team_role <> 'admin';

-- Admins can turn off joining with the shared code (invitations only).
alter table public.organizations add column if not exists allow_code_join boolean not null default true;

-- Is the signed-in person an admin of this team? (The team's creator always is.)
create or replace function public.is_team_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
      join public.organizations o on o.id = p.organization_id
     where p.id = auth.uid()
       and p.organization_id = org
       and (p.team_role = 'admin' or o.created_by = auth.uid())
  )
$$;

-- ── Teams are visible only to their own members ─────────────────────
drop policy if exists "orgs are publicly readable" on public.organizations;
drop policy if exists "members can read their own team" on public.organizations;
create policy "members can read their own team"
  on public.organizations for select
  using (id = public.current_user_org_id());

-- Any member may change the logo or shared topics; admins may also rename
-- the team, change the invite code or turn code joining off. Only the
-- current owner (or the server) can hand ownership to someone else.
create or replace function public.enforce_org_update_permissions()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- The server (service key) and the SQL Editor aren't limited here.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.current_user_org_id() is distinct from old.id then
    raise exception 'not a member of this team';
  end if;
  if new.created_by is distinct from old.created_by and old.created_by is distinct from auth.uid() then
    raise exception 'only the team owner can hand over ownership';
  end if;
  if (new.name is distinct from old.name
      or new.invite_code is distinct from old.invite_code
      or new.allow_code_join is distinct from old.allow_code_join)
     and not public.is_team_admin(old.id) then
    raise exception 'only a team admin can change that';
  end if;
  return new;
end;
$$;

-- People can't put themselves into a team or promote themselves; leaving
-- is allowed (and makes them a plain member again).
create or replace function public.guard_profile_team_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.organization_id := null;
    new.team_role := 'member';
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    if new.organization_id is not null then
      raise exception 'join a team with an invitation or its invite code';
    end if;
    new.team_role := 'member';
  elsif new.team_role is distinct from old.team_role then
    raise exception 'only a team admin can change roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profile_team_fields_guard on public.profiles;
create trigger profile_team_fields_guard
  before insert or update on public.profiles
  for each row execute function public.guard_profile_team_fields();

-- ── Email invitations ───────────────────────────────────────────────
create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  -- The secret in the join link. Two random UUIDs: 244 random bits.
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
create unique index if not exists team_invites_one_open_per_email
  on public.team_invites (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;
alter table public.team_invites enable row level security;
-- Admins see their team's invitations. Creating, resending, revoking and
-- accepting all go through the server, which checks who's asking.
drop policy if exists "team admins can see invitations" on public.team_invites;
create policy "team admins can see invitations"
  on public.team_invites for select
  using (public.is_team_admin(organization_id));

-- ── Notifications: the bell, and what's pushed to devices ───────────
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,          -- bill_update, drug_board, team, task, client_report, test
  title text not null,
  body text,
  url text,                    -- where clicking it goes, inside the app
  dedupe_key text,             -- stops the same alert being created twice
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_sent_at timestamptz
);
create index if not exists notifications_user_recent on public.notifications (user_id, created_at desc);
create unique index if not exists notifications_once on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
alter table public.notifications enable row level security;
drop policy if exists "people see their own notifications" on public.notifications;
create policy "people see their own notifications"
  on public.notifications for select using (user_id = auth.uid());
drop policy if exists "people mark their own notifications read" on public.notifications;
create policy "people mark their own notifications read"
  on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "people clear their own notifications" on public.notifications;
create policy "people clear their own notifications"
  on public.notifications for delete using (user_id = auth.uid());

-- One row per device (browser) someone has allowed to receive push alerts.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_label text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "people see their own devices" on public.push_subscriptions;
create policy "people see their own devices"
  on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists "people remove their own devices" on public.push_subscriptions;
create policy "people remove their own devices"
  on public.push_subscriptions for delete using (user_id = auth.uid());

-- Assigning someone a task tells them (in the bell, and on their devices).
create or replace function public.notify_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if new.kind <> 'task' or new.assigned_to is null or new.assigned_to = auth.uid() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;
  -- Only teammates: the assignee must be on the team the task belongs to.
  if new.organization_id is null or not exists (
    select 1 from public.profiles where id = new.assigned_to and organization_id = new.organization_id
  ) then
    return new;
  end if;
  select coalesce(nullif(trim(full_name), ''), email) into who from public.profiles where id = auth.uid();
  insert into public.notifications (user_id, kind, title, body, url, dedupe_key)
  values (
    new.assigned_to,
    'task',
    coalesce(who, 'A teammate') || ' assigned you a task',
    left(new.body, 200),
    case when new.bill_id is not null then '/bill/' || new.bill_id || '?tab=workspace' else '/team' end,
    'task:' || new.id || ':' || new.assigned_to
  )
  on conflict do nothing;
  return new;
end;
$$;

do $$ begin
  if to_regclass('public.bill_workspace_items') is not null then
    drop trigger if exists bill_workspace_task_assigned on public.bill_workspace_items;
    create trigger bill_workspace_task_assigned
      after insert or update of assigned_to on public.bill_workspace_items
      for each row execute function public.notify_task_assignment();
  end if;
end $$;

-- Server-only settings the app creates for itself, such as the key pair
-- that signs push alerts. No one signed in can read this table.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;

insert into public.schema_migrations (id, name)
values ('0007', 'Teams and notifications')
on conflict (id) do nothing;

notify pgrst, 'reload schema';

-- 0004: Clients and the Monday report.
--
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.

-- A client belongs to your team (or to you, if you aren't on a team), the
-- same way topics and suggestions do. Everyone on the team can see and edit
-- every client.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  notes text,
  lead_user_id uuid references auth.users(id) on delete set null,
  -- The Monday report.
  report_enabled boolean not null default false,
  report_ask text,                        -- "What we need from you"
  -- Read-only link the client can open without an account. Null = off.
  share_token uuid unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_owner_check check (
    (organization_id is not null and user_id is null) or
    (organization_id is null and user_id is not null)
  )
);
create index if not exists clients_org_idx on public.clients (organization_id);
create index if not exists clients_user_idx on public.clients (user_id);

-- True when the signed-in person may see this client. SECURITY DEFINER so the
-- child-table policies below don't re-run the clients policy recursively.
create or replace function public.can_access_client(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.clients c
    where c.id = target
      and ((c.organization_id is not null and c.organization_id = public.current_user_org_id())
           or c.user_id = auth.uid())
  )
$$;

alter table public.clients enable row level security;
drop policy if exists "team sees its clients" on public.clients;
create policy "team sees its clients"
  on public.clients for select
  using ((organization_id is not null and organization_id = public.current_user_org_id()) or user_id = auth.uid());
drop policy if exists "team adds clients" on public.clients;
create policy "team adds clients"
  on public.clients for insert
  with check (
    (organization_id is not null and organization_id = public.current_user_org_id() and user_id is null)
    or (organization_id is null and user_id = auth.uid())
  );
drop policy if exists "team edits its clients" on public.clients;
create policy "team edits its clients"
  on public.clients for update
  using ((organization_id is not null and organization_id = public.current_user_org_id()) or user_id = auth.uid())
  with check ((organization_id is not null and organization_id = public.current_user_org_id()) or user_id = auth.uid());
drop policy if exists "team removes its clients" on public.clients;
create policy "team removes its clients"
  on public.clients for delete
  using ((organization_id is not null and organization_id = public.current_user_org_id()) or user_id = auth.uid());

-- The bills a client cares about, with your position on each for them.
create table if not exists public.client_bills (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  bill_id text not null references public.bills(id) on delete cascade,
  position text not null default 'watching' check (position in ('support', 'oppose', 'watching', 'none')),
  note text,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  unique (client_id, bill_id)
);
create index if not exists client_bills_bill_idx on public.client_bills (bill_id);
alter table public.client_bills enable row level security;
drop policy if exists "team manages client bills" on public.client_bills;
create policy "team manages client bills"
  on public.client_bills for all
  using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- Who at the client receives the Monday report.
create table if not exists public.client_recipients (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  name text,
  created_at timestamptz not null default now()
);
create unique index if not exists client_recipients_unique_email on public.client_recipients (client_id, lower(email));
alter table public.client_recipients enable row level security;
drop policy if exists "team manages client recipients" on public.client_recipients;
create policy "team manages client recipients"
  on public.client_recipients for all
  using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- Every report that went out: what it said, when, and to whom.
create table if not exists public.client_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  week_of date not null,
  sent_at timestamptz not null default now(),
  sent_to text[] not null default '{}',
  sent_by uuid references auth.users(id) on delete set null,   -- null = sent automatically
  is_test boolean not null default false,
  payload jsonb not null
);
create index if not exists client_reports_client_week_idx on public.client_reports (client_id, week_of desc);
alter table public.client_reports enable row level security;
drop policy if exists "team sees sent client reports" on public.client_reports;
create policy "team sees sent client reports"
  on public.client_reports for select
  using (public.can_access_client(client_id));

insert into public.schema_migrations (id, name)
values ('0004', 'Clients and the Monday report')
on conflict (id) do nothing;

notify pgrst, 'reload schema';

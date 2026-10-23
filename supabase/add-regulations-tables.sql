-- Federal Register regulation tracking: the two tables the Regulations page
-- and the daily regulation discovery job use. These were never included in
-- the repository's SQL files, so if your database doesn't have them, the
-- Regulations page stays empty and discovery fails quietly.
--
-- Safe to run even if the tables already exist: every statement is
-- "if not exists" / "drop policy if exists" first.
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.

create table if not exists public.regulations (
  id text primary key,                -- Federal Register document number
  title text not null,
  abstract text,
  doc_type text,                      -- Rule, Proposed Rule, Notice, ...
  docket_id text,
  agencies jsonb,
  publication_date date,
  comment_close_date date,
  effective_date date,
  html_url text,
  pdf_url text,
  raw_snapshot jsonb,
  last_polled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.regulations enable row level security;
drop policy if exists "regulations readable by authenticated users" on public.regulations;
create policy "regulations readable by authenticated users"
  on public.regulations for select
  using (auth.role() = 'authenticated');

create table if not exists public.prospective_regulations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  regulation_id text not null references public.regulations(id) on delete cascade,
  matched_topic text not null,
  discovered_at timestamptz not null default now(),
  dismissed boolean not null default false,
  constraint prospective_regulations_owner_check check (
    (organization_id is not null and user_id is null) or
    (organization_id is null and user_id is not null)
  )
);
alter table public.prospective_regulations enable row level security;

drop policy if exists "owners see their prospective regulations" on public.prospective_regulations;
create policy "owners see their prospective regulations"
  on public.prospective_regulations for select
  using (
    (organization_id is not null and organization_id = public.current_user_org_id())
    or user_id = auth.uid()
  );

drop policy if exists "owners can dismiss their prospective regulations" on public.prospective_regulations;
create policy "owners can dismiss their prospective regulations"
  on public.prospective_regulations for update
  using (
    (organization_id is not null and organization_id = public.current_user_org_id())
    or user_id = auth.uid()
  );

create index if not exists prospective_regulations_org_idx on public.prospective_regulations (organization_id, dismissed, discovered_at desc);
create index if not exists prospective_regulations_user_idx on public.prospective_regulations (user_id, dismissed, discovered_at desc);

notify pgrst, 'reload schema';

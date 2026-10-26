-- 0001: keep track of which database updates have been run, and keep a log
-- of every scheduled run.
--
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.

-- Every numbered file in supabase/migrations/ ends by adding its own row
-- here. The Data sources page reads this table to show which updates are
-- still waiting to be run, so nobody has to remember.
create table if not exists public.schema_migrations (
  id text primary key,              -- e.g. '0001'
  name text not null,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
drop policy if exists "signed-in users can read the update log" on public.schema_migrations;
create policy "signed-in users can read the update log"
  on public.schema_migrations for select
  using (auth.role() = 'authenticated');

-- One row per run of a scheduled job (the morning check, the alert run).
-- Written only by the server with the admin key; readable by signed-in
-- users so the Data sources page can show recent runs.
create table if not exists public.job_runs (
  id bigserial primary key,
  job text not null,                -- 'poll' | 'notify'
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb,
  error text
);
create index if not exists job_runs_job_started_idx on public.job_runs (job, started_at desc);
alter table public.job_runs enable row level security;
drop policy if exists "signed-in users can read job runs" on public.job_runs;
create policy "signed-in users can read job runs"
  on public.job_runs for select
  using (auth.role() = 'authenticated');

-- Small key/value store for background syncs (where a sync left off, and a
-- short lock so two syncs never run at the same moment). Server-only.
create table if not exists public.sync_state (
  key text primary key,
  cursor text,
  last_run_at timestamptz,
  locked_until timestamptz
);
alter table public.sync_state enable row level security;

insert into public.schema_migrations (id, name)
values ('0001', 'Update log and job runs')
on conflict (id) do nothing;

notify pgrst, 'reload schema';

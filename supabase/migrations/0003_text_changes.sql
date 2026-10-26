-- 0003: What changed between versions of a bill's text.
--
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.

-- Comparing two versions of a long bill takes a few seconds, and a
-- published version never changes, so each comparison is worked out once
-- and kept here.
create table if not exists public.bill_text_diffs (
  bill_id text not null references public.bills(id) on delete cascade,
  from_package text not null,            -- e.g. BILLS-119hr4120ih
  to_package text not null,              -- e.g. BILLS-119hr4120rh
  result jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (bill_id, from_package, to_package)
);
alter table public.bill_text_diffs enable row level security;
drop policy if exists "text comparisons readable by signed-in users" on public.bill_text_diffs;
create policy "text comparisons readable by signed-in users"
  on public.bill_text_diffs for select
  using (auth.role() = 'authenticated');

insert into public.schema_migrations (id, name)
values ('0003', 'Text changes')
on conflict (id) do nothing;

notify pgrst, 'reload schema';

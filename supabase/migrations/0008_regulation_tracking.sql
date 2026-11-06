-- 0008: Following regulations as a team.
--
-- Each regulation on the Regulations page gets a shared status: Following,
-- Writing a comment, or Comment sent. The page shows who set it and when,
-- and people following a regulation are reminded a week before its comment
-- period closes and again the day before.
--
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.

alter table public.prospective_regulations add column if not exists status text not null default 'new';
alter table public.prospective_regulations drop constraint if exists prospective_regulations_status_check;
alter table public.prospective_regulations add constraint prospective_regulations_status_check
  check (status in ('new', 'following', 'commenting', 'commented'));
alter table public.prospective_regulations add column if not exists status_by uuid references public.profiles(id) on delete set null;
alter table public.prospective_regulations add column if not exists status_at timestamptz;

-- Who changed the status, and when, is recorded by the database itself so
-- nobody can put someone else's name on a change.
create or replace function public.stamp_regulation_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.status_by := auth.uid();
    new.status_at := now();
  else
    new.status_by := old.status_by;
    new.status_at := old.status_at;
  end if;
  return new;
end;
$$;
drop trigger if exists prospective_regulations_status_stamp on public.prospective_regulations;
create trigger prospective_regulations_status_stamp
  before update on public.prospective_regulations
  for each row execute function public.stamp_regulation_status();

-- The morning reminder looks up regulations being followed.
create index if not exists prospective_regulations_status_idx
  on public.prospective_regulations (status) where status in ('following', 'commenting');

insert into public.schema_migrations (id, name)
values ('0008', 'Following regulations')
on conflict (id) do nothing;

notify pgrst, 'reload schema';

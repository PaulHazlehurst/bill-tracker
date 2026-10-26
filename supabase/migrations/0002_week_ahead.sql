-- 0002: Week ahead. Committee meetings, the House floor schedule, and
-- private calendar feed links.
--
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.

-- Committee hearings, markups and meetings, copied from congress.gov so the
-- Week ahead page loads instantly and can be filtered by date (congress.gov
-- itself can only filter by when a record was last edited).
create table if not exists public.committee_meetings (
  event_id text primary key,
  congress integer not null,
  chamber text not null,                 -- House | Senate | NoChamber
  meeting_at timestamptz,                -- when it is held
  title text,
  meeting_type text,                     -- Hearing | Markup | Meeting
  status text,                           -- Scheduled | Canceled | Postponed | Rescheduled
  committees jsonb not null default '[]',
  location text,
  bill_ids text[] not null default '{}', -- e.g. {hr-4120-119}
  witness_count integer not null default 0,
  document_count integer not null default 0,
  video_url text,
  source_updated_at text,                -- congress.gov's updateDate, to skip unchanged records
  fetched_at timestamptz not null default now()
);
create index if not exists committee_meetings_meeting_at_idx on public.committee_meetings (meeting_at);
create index if not exists committee_meetings_bill_ids_idx on public.committee_meetings using gin (bill_ids);
alter table public.committee_meetings enable row level security;
drop policy if exists "committee meetings readable by signed-in users" on public.committee_meetings;
create policy "committee meetings readable by signed-in users"
  on public.committee_meetings for select
  using (auth.role() = 'authenticated');

-- The House Majority Leader's weekly floor schedule ("Bills This Week").
create table if not exists public.floor_weeks (
  week_of date primary key,              -- the Monday of that week
  items jsonb not null default '[]',
  source_url text,
  fetched_at timestamptz not null default now()
);
alter table public.floor_weeks enable row level security;
drop policy if exists "floor schedule readable by signed-in users" on public.floor_weeks;
create policy "floor schedule readable by signed-in users"
  on public.floor_weeks for select
  using (auth.role() = 'authenticated');

-- A private, revocable link per person for subscribing to their week in
-- Google Calendar or Outlook. Kept out of profiles because teammates can
-- read each other's profile rows.
create table if not exists public.calendar_feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
drop policy if exists "people manage their own calendar link" on public.calendar_feeds;
create policy "people manage their own calendar link"
  on public.calendar_feeds for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into public.schema_migrations (id, name)
values ('0002', 'Week ahead')
on conflict (id) do nothing;

notify pgrst, 'reload schema';

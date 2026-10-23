-- October 2026 update: accurate bill activity + better topic discovery.
-- Run once in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once (every statement is "if not exists").
-- The app keeps working before this is run; it just can't store the new
-- fields until it is.

-- 1. Real action dates and structured details on activity events.
--    Events used to be stamped with the time the daily check ran, so an
--    action from last Tuesday showed up as "today".
alter table public.bill_events add column if not exists action_date date;
alter table public.bill_events add column if not exists details jsonb;

create index if not exists bill_events_bill_action_date_idx
  on public.bill_events (bill_id, action_date desc nulls last);

-- 2. Why a suggested bill matched, and how strongly.
alter table public.prospective_bills add column if not exists match_reason text;
alter table public.prospective_bills add column if not exists match_score real;

-- 3. Indexes the poller and dashboards lean on (no-ops if they exist).
create index if not exists profiles_organization_id_idx on public.profiles (organization_id);
create index if not exists bills_last_polled_at_idx on public.bills (last_polled_at desc);
create index if not exists bill_events_occurred_at_idx on public.bill_events (occurred_at desc);
create index if not exists bill_events_unnotified_idx on public.bill_events (occurred_at) where notified_at is null;
create index if not exists tracked_bills_user_created_idx on public.tracked_bills (user_id, created_at desc);
create index if not exists prospective_bills_org_idx on public.prospective_bills (organization_id, dismissed, discovered_at desc);
create index if not exists prospective_bills_user_idx on public.prospective_bills (user_id, dismissed, discovered_at desc);

-- 3b. Team task board columns (assignee, due date, tasks not tied to one
--     bill). Only applies if the workspace table exists - if it doesn't,
--     run supabase/add-bill-workspace-table.sql first, then this file again.
do $$
begin
  if to_regclass('public.bill_workspace_items') is not null then
    alter table public.bill_workspace_items alter column bill_id drop not null;
    alter table public.bill_workspace_items add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
    alter table public.bill_workspace_items add column if not exists due_date date;
    create index if not exists bill_workspace_items_tasks_idx on public.bill_workspace_items (organization_id, done) where kind = 'task';
  end if;
end $$;

-- 4. Fix the "View on congress.gov" links. These were stored as the API's
--    own address (which errors without an API key) instead of the public
--    page. This rewrites every existing row to the public URL.
update public.bills
set congress_url = 'https://www.congress.gov/bill/' || congress ||
  case
    when congress % 100 between 11 and 13 then 'th'
    when congress % 10 = 1 then 'st'
    when congress % 10 = 2 then 'nd'
    when congress % 10 = 3 then 'rd'
    else 'th'
  end || '-congress/' ||
  case bill_type
    when 'hr' then 'house-bill'
    when 's' then 'senate-bill'
    when 'hjres' then 'house-joint-resolution'
    when 'sjres' then 'senate-joint-resolution'
    when 'hconres' then 'house-concurrent-resolution'
    when 'sconres' then 'senate-concurrent-resolution'
    when 'hres' then 'house-resolution'
    when 'sres' then 'senate-resolution'
    else 'house-bill'
  end || '/' || bill_number
where congress_url is null or congress_url like '%api.congress.gov%';

-- 5. Make every tracked bill due for a re-check on the next run, so stages
--    are recomputed from full action history right away.
update public.bills
set actions_fetched_at = null
where id in (select distinct bill_id from public.tracked_bills);

analyze public.bill_events;
analyze public.prospective_bills;
analyze public.bills;
notify pgrst, 'reload schema';

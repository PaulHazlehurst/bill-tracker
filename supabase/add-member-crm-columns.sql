-- Turns the stakeholder roster into a real relationship CRM. Every column
-- is nullable and additive, so existing member rows are untouched and this
-- is safe to run on a live database. Run this in the Supabase SQL Editor.

-- What kind of stakeholder this is (Legislator, Staffer, Coalition partner,
-- Client, Agency, Other) - lets the roster be grouped and filtered.
alter table members add column if not exists category text;

-- Direct contact details, so an outreach call or email is one click from
-- the roster instead of a separate lookup.
alter table members add column if not exists email text;
alter table members add column if not exists phone text;

-- Free-form relationship notes: who owns the relationship, meeting history,
-- outstanding asks. This is the single most valuable thing lobbying shops
-- pay Bloomberg/Quorum for.
alter table members add column if not exists notes text;

-- Optional link to a real member of Congress (their congress.gov bioguide
-- id), so a "congressional contact" stakeholder can connect through to the
-- live Legislators profile - bills, votes, contact. Reserved for the
-- Members<->Legislators bridge.
alter table members add column if not exists bioguide_id text;

notify pgrst, 'reload schema';

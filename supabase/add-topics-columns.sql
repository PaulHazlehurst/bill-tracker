-- ═══════════════════════════════════════════════════════════════════
-- Add "topics" column to profiles and organizations
-- ═══════════════════════════════════════════════════════════════════
-- Run this in: Supabase Dashboard → SQL Editor → New query → Paste → Run
--
-- Safe to run more than once (IF NOT EXISTS).
-- This fixes:
--   "Could not find the 'topics' column of 'profiles' in the schema cache"
--   "column organizations_1.topics does not exist"
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add topics array to profiles (for solo users not on a team)
alter table profiles
  add column if not exists topics text[] not null default '{}';

-- 2. Add topics array to organizations (shared across team members)
alter table organizations
  add column if not exists topics text[] not null default '{}';

-- 3. Reload the PostgREST schema cache so Supabase picks up the new
--    columns immediately (otherwise you'd need to wait or restart).
notify pgrst, 'reload schema';

-- Per-bill Workspace: team notes + a task checklist attached to each bill.
-- This is what turns a bill page from something you READ into something your
-- team WORKS - leave analysis for a colleague, assign a follow-up, check it
-- off. Run this once in the Supabase SQL Editor. Safe and idempotent.
--
-- Ownership mirrors prospective_bills exactly: an org's items are shared
-- across the whole team (organization_id set, user_id null); a solo user's
-- items are private to them (user_id set, organization_id null). Row-level
-- security enforces that split - the anon key can only ever see or change
-- items that belong to the caller's own org or account.

create table if not exists bill_workspace_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  bill_id text not null references bills(id) on delete cascade,
  kind text not null check (kind in ('note', 'task')),
  body text not null,
  done boolean not null default false,           -- tasks only; ignored for notes
  -- References profiles (not auth.users) so we can embed the author's email
  -- for display in one query. profiles.id === auth.users.id, so this is the
  -- same identity, just the join-able side of it.
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bill_workspace_owner_check check (
    (organization_id is not null and user_id is null) or
    (organization_id is null and user_id is not null)
  )
);

create index if not exists bill_workspace_items_bill_idx on bill_workspace_items (bill_id);
create index if not exists bill_workspace_items_org_idx on bill_workspace_items (organization_id);

alter table bill_workspace_items enable row level security;

-- SELECT: your team's items, or (solo) your own.
drop policy if exists "workspace items visible to owner" on bill_workspace_items;
create policy "workspace items visible to owner"
  on bill_workspace_items for select
  using (
    (organization_id is not null and organization_id = public.current_user_org_id())
    or user_id = auth.uid()
  );

-- INSERT: you may only create items owned by your own org or your own account.
drop policy if exists "workspace items insertable by owner" on bill_workspace_items;
create policy "workspace items insertable by owner"
  on bill_workspace_items for insert
  with check (
    (organization_id is not null and organization_id = public.current_user_org_id() and user_id is null)
    or (user_id = auth.uid() and organization_id is null)
  );

-- UPDATE: any teammate can tick a task or edit a shared item; solo users, their own.
drop policy if exists "workspace items updatable by owner" on bill_workspace_items;
create policy "workspace items updatable by owner"
  on bill_workspace_items for update
  using (
    (organization_id is not null and organization_id = public.current_user_org_id())
    or user_id = auth.uid()
  )
  with check (
    (organization_id is not null and organization_id = public.current_user_org_id())
    or user_id = auth.uid()
  );

-- DELETE: same ownership rule.
drop policy if exists "workspace items deletable by owner" on bill_workspace_items;
create policy "workspace items deletable by owner"
  on bill_workspace_items for delete
  using (
    (organization_id is not null and organization_id = public.current_user_org_id())
    or user_id = auth.uid()
  );

notify pgrst, 'reload schema';

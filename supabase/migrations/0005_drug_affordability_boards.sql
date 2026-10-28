-- 0005: State prescription drug affordability boards.
--
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.
--
-- Everything here is public information (what state boards publish), so,
-- like bills, it's shared by everyone signed in and anyone on the team can
-- correct it. Every change to a drug's status is kept in a history table
-- with who made it.

-- ── The boards ──────────────────────────────────────────────────────
create table if not exists public.drug_boards (
  state text primary key,                  -- two-letter code, e.g. 'CO'
  name text not null,
  agency text,
  status text not null default 'active' check (status in ('active', 'limited', 'dissolved', 'proposed')),
  authority text,                          -- short label, e.g. 'Can set price limits'
  summary text,
  summary_source text,                     -- where the summary comes from
  website text,
  email_signup text,
  sort integer not null default 100,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.drug_boards enable row level security;
drop policy if exists "drug boards readable by signed-in users" on public.drug_boards;
create policy "drug boards readable by signed-in users" on public.drug_boards for select using (auth.role() = 'authenticated');
drop policy if exists "signed-in users can correct drug boards" on public.drug_boards;
create policy "signed-in users can correct drug boards" on public.drug_boards for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "signed-in users can add drug boards" on public.drug_boards;
create policy "signed-in users can add drug boards" on public.drug_boards for insert with check (auth.role() = 'authenticated');

-- ── The pages the app checks every morning for new documents ────────
create table if not exists public.board_pages (
  id uuid primary key default gen_random_uuid(),
  state text not null references public.drug_boards(state) on delete cascade,
  url text not null unique,
  label text,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.board_pages enable row level security;
drop policy if exists "signed-in users manage watched board pages" on public.board_pages;
create policy "signed-in users manage watched board pages" on public.board_pages for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── Documents found on those pages (agendas, minutes, reports) ──────
create table if not exists public.board_documents (
  id uuid primary key default gen_random_uuid(),
  state text not null references public.drug_boards(state) on delete cascade,
  page_id uuid references public.board_pages(id) on delete set null,
  url text not null unique,
  title text,
  kind text,                               -- agenda | minutes | materials | report | notice | other
  doc_date date,                           -- read from the title or address when it has one
  first_seen_at timestamptz not null default now(),
  baseline boolean not null default false, -- already there the first time we looked: not "new"
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  notified_at timestamptz
);
create index if not exists board_documents_state_seen_idx on public.board_documents (state, first_seen_at desc);
create index if not exists board_documents_date_idx on public.board_documents (doc_date);
alter table public.board_documents enable row level security;
drop policy if exists "board documents readable by signed-in users" on public.board_documents;
create policy "board documents readable by signed-in users" on public.board_documents for select using (auth.role() = 'authenticated');
drop policy if exists "signed-in users can mark board documents reviewed" on public.board_documents;
create policy "signed-in users can mark board documents reviewed" on public.board_documents for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── Drugs under review, kept current by your team ───────────────────
create table if not exists public.board_drugs (
  id uuid primary key default gen_random_uuid(),
  state text not null references public.drug_boards(state) on delete cascade,
  drug text not null,
  manufacturer text,
  stage text not null default 'selected' check (stage in ('identified', 'selected', 'under_review', 'unaffordable', 'limit_proposed', 'limit_set', 'limit_blocked', 'recommendation', 'closed')),
  price_limit text,                        -- e.g. '$600 per dose'
  limit_basis text,                        -- e.g. 'Close to the Medicare negotiated price'
  next_step text,
  next_date date,
  source_url text,
  notes text,
  needs_check boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists board_drugs_state_idx on public.board_drugs (state);
alter table public.board_drugs enable row level security;
drop policy if exists "signed-in users manage the drug tracker" on public.board_drugs;
create policy "signed-in users manage the drug tracker" on public.board_drugs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists public.board_drug_changes (
  id bigserial primary key,
  board_drug_id uuid not null references public.board_drugs(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  summary text not null
);
create index if not exists board_drug_changes_drug_idx on public.board_drug_changes (board_drug_id, changed_at desc);
alter table public.board_drug_changes enable row level security;
drop policy if exists "drug tracker history readable by signed-in users" on public.board_drug_changes;
create policy "drug tracker history readable by signed-in users" on public.board_drug_changes for select using (auth.role() = 'authenticated');
drop policy if exists "signed-in users record drug tracker history" on public.board_drug_changes;
create policy "signed-in users record drug tracker history" on public.board_drug_changes for insert with check (auth.role() = 'authenticated' and changed_by = auth.uid());

-- ── Board meetings and comment deadlines your team adds ─────────────
create table if not exists public.board_dates (
  id uuid primary key default gen_random_uuid(),
  state text not null references public.drug_boards(state) on delete cascade,
  date date not null,
  time text,                               -- as the board writes it, e.g. '2:00 PM'
  kind text not null default 'meeting' check (kind in ('meeting', 'comment_deadline', 'hearing', 'other')),
  title text not null,
  url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists board_dates_date_idx on public.board_dates (date);
alter table public.board_dates enable row level security;
drop policy if exists "signed-in users manage board dates" on public.board_dates;
create policy "signed-in users manage board dates" on public.board_dates for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── State bills about drug affordability boards (from Open States) ──
create table if not exists public.state_bills (
  id text primary key,                     -- Open States id, e.g. ocd-bill/...
  state text not null,                     -- two-letter code
  session text,
  identifier text not null,                -- e.g. 'HB 1234'
  title text not null,
  latest_action text,
  latest_action_date date,
  url text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  hidden boolean not null default false,   -- "not relevant"
  hidden_by uuid references auth.users(id) on delete set null,
  notified_at timestamptz
);
create index if not exists state_bills_state_idx on public.state_bills (state, latest_action_date desc);
alter table public.state_bills enable row level security;
drop policy if exists "state bills readable by signed-in users" on public.state_bills;
create policy "state bills readable by signed-in users" on public.state_bills for select using (auth.role() = 'authenticated');
drop policy if exists "signed-in users can hide state bills" on public.state_bills;
create policy "signed-in users can hide state bills" on public.state_bills for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── Opt-in email when boards post something new ─────────────────────
alter table public.profiles add column if not exists drug_board_alerts boolean not null default false;

-- ── Starting point. Your team can correct any of it in the app. ─────
-- Sources: Avalere (Aug 2026), Families USA (Apr 2026), MultiState (Jun 2026)
-- and each board's own site. Entries marked needs_check disagree between sources.
insert into public.drug_boards (state, name, agency, status, authority, summary, summary_source, website, email_signup, sort) values
  ('CO', 'Colorado Prescription Drug Affordability Review Board', 'Division of Insurance', 'active', 'Can set price limits',
   'Set the nation''s first upper payment limit, for Enbrel, in October 2025. A federal judge blocked it in July 2026 while the case continues.',
   'https://avalerehealth.com/thought-leadership/state-pricing-controls-at-an-inflection-point-maximum-fair-price-and-the-shifting-prescription-drug-affordability-board-landscape/',
   'https://doi.colorado.gov/types-of-insurance/health-insurance/prescription-drug-affordability-review-board', 'https://doi.colorado.gov/sign-up-for-division-of-insurance-email-lists', 1),
  ('MD', 'Maryland Prescription Drug Affordability Board', null, 'active', 'Can set price limits',
   'A 2025 law extended its limits from state programs to everyone in Maryland. Sources differ on which limits were finalized in 2026; check the board''s Upper Payment Limits page.',
   'https://familiesusa.org/wp-content/uploads/2026/04/PDABs-1-Pager_2026-Update_Fact-Sheet-1.pdf',
   'https://pdab.prod.maryland.gov/', null, 2),
  ('MN', 'Minnesota Prescription Drug Affordability Board', 'Department of Commerce', 'active', 'Can set price limits',
   'Still setting up its drug cost review process; no reviews finished yet.',
   'https://www.multistate.us/insider/2026/6/8/pdab-implementation-challenges-slow-state-drug-cost-efforts',
   'https://mn.gov/commerce/insurance/health/pharmacy-drug-affordability-board/index.jsp', 'https://public.govdelivery.com/accounts/MNCOMM/subscriber/new', 3),
  ('WA', 'Washington Prescription Drug Affordability Board', 'Health Care Authority', 'active', 'Can set price limits',
   'Still building its rules; no affordability reviews finished yet.',
   'https://www.multistate.us/insider/2026/6/8/pdab-implementation-challenges-slow-state-drug-cost-efforts',
   'https://www.hca.wa.gov/about-hca/programs-and-initiatives/clinical-collaboration-and-initiatives/prescription-drug-affordability-board', null, 4),
  ('OR', 'Oregon Prescription Drug Affordability Board', 'Division of Financial Regulation', 'active', 'Recommendations only',
   'Can''t cap prices. Has reviewed more than 30 drugs and sends recommendations to the Legislature.',
   'https://avalerehealth.com/thought-leadership/state-pricing-controls-at-an-inflection-point-maximum-fair-price-and-the-shifting-prescription-drug-affordability-board-landscape/',
   'https://dfr.oregon.gov/pdab/pages/index.aspx', null, 5),
  ('ME', 'Maine Prescription Drug Affordability Board', 'Office of Affordable Health Care', 'active', 'Check current law',
   'Reviews drug spending for public payers. Reports say a newer law lets it set payment limits; confirm the details.',
   'https://familiesusa.org/wp-content/uploads/2026/04/PDABs-1-Pager_2026-Update_Fact-Sheet-1.pdf',
   'https://www.maine.gov/oahc/our-work/PDAB', null, 6),
  ('NJ', 'New Jersey Drug Affordability Council', 'Division of Consumer Affairs', 'limited', 'Recommendations only',
   'A council rather than a board: it recommends policy and the state collects drug pricing data. No price limits.',
   'https://www.drugtopics.com/view/nj-governor-phil-murphy-signs-pbm-drug-price-legislation',
   'https://www.njconsumeraffairs.gov/dau/Pages/default.aspx', null, 7),
  ('NH', 'New Hampshire Prescription Drug Affordability Board', null, 'dissolved', 'Dissolved',
   'Dissolved in 2025 budget legislation.',
   'https://avalerehealth.com/thought-leadership/state-pricing-controls-at-an-inflection-point-maximum-fair-price-and-the-shifting-prescription-drug-affordability-board-landscape/', null, null, 90),
  ('OH', 'Ohio Prescription Drug Affordability Board', null, 'dissolved', 'Dissolved',
   'Dissolved in 2025 budget legislation.',
   'https://avalerehealth.com/thought-leadership/state-pricing-controls-at-an-inflection-point-maximum-fair-price-and-the-shifting-prescription-drug-affordability-board-landscape/', null, null, 91)
on conflict (state) do nothing;

insert into public.board_pages (state, url, label) values
  ('CO', 'https://doi.colorado.gov/types-of-insurance/health-insurance/prescription-drug-affordability-review-board', 'Board page'),
  ('MD', 'https://pdab.prod.maryland.gov/public-meetings', 'Public meetings'),
  ('MD', 'https://pdab.prod.maryland.gov/cost-reviews', 'Cost reviews'),
  ('MD', 'https://pdab.prod.maryland.gov/upper-payment-limits', 'Upper payment limits'),
  ('MN', 'https://mn.gov/commerce/insurance/health/pharmacy-drug-affordability-board/index.jsp', 'Board page and meetings'),
  ('WA', 'https://www.hca.wa.gov/about-hca/programs-and-initiatives/clinical-collaboration-and-initiatives/prescription-drug-affordability-board', 'Board page'),
  ('OR', 'https://dfr.oregon.gov/pdab/Pages/board-calendar.aspx', 'Board calendar and materials'),
  ('OR', 'https://dfr.oregon.gov/pdab/Pages/affordability-review.aspx', 'Drug reviews'),
  ('ME', 'https://www.maine.gov/oahc/our-work/PDAB', 'Board page'),
  ('NJ', 'https://www.njconsumeraffairs.gov/dau/Pages/default.aspx', 'Drug Affordability Unit')
on conflict (url) do nothing;

insert into public.board_drugs (id, state, drug, manufacturer, stage, price_limit, limit_basis, next_step, source_url, notes, needs_check) values
  ('c0000000-0000-4000-8000-000000000001', 'CO', 'Enbrel', 'Amgen', 'limit_blocked', '$600 per dose', 'Close to the Medicare negotiated price',
   'Court hearing on the merits', 'https://avalerehealth.com/thought-leadership/state-pricing-controls-at-an-inflection-point-maximum-fair-price-and-the-shifting-prescription-drug-affordability-board-landscape/',
   'Set October 2025 to start January 2027. A federal judge granted a preliminary injunction on July 1, 2026 (patent preemption).', false),
  ('c0000000-0000-4000-8000-000000000002', 'MD', 'Jardiance', 'Boehringer Ingelheim', 'limit_set', null, 'Tied to the Medicare negotiated price',
   null, 'https://avalerehealth.com/thought-leadership/state-pricing-controls-at-an-inflection-point-maximum-fair-price-and-the-shifting-prescription-drug-affordability-board-landscape/',
   'Avalere (Aug 2026) reports a limit was set in 2026; Families USA (Apr 2026) described it as upcoming.', true),
  ('c0000000-0000-4000-8000-000000000003', 'MD', 'Ozempic', 'Novo Nordisk', 'limit_set', null, 'Tied to the Medicare negotiated price',
   null, 'https://avalerehealth.com/thought-leadership/state-pricing-controls-at-an-inflection-point-maximum-fair-price-and-the-shifting-prescription-drug-affordability-board-landscape/',
   'Reported by Avalere (Aug 2026). Confirm on the board''s Upper Payment Limits page.', true),
  ('c0000000-0000-4000-8000-000000000004', 'MD', 'Farxiga', 'AstraZeneca', 'closed', null, null,
   null, 'https://avalerehealth.com/thought-leadership/state-pricing-controls-at-an-inflection-point-maximum-fair-price-and-the-shifting-prescription-drug-affordability-board-landscape/',
   'Limit deferred after the patent expired and generics arrived (Avalere, Aug 2026).', true)
on conflict (id) do nothing;

insert into public.schema_migrations (id, name)
values ('0005', 'Drug affordability boards')
on conflict (id) do nothing;

notify pgrst, 'reload schema';

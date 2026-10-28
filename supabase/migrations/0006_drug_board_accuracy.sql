-- 0006: More accurate drug board tracking.
--
-- Run in Supabase -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once. Run 0005 first.
--
-- Adds:
--  * "last checked" dates on boards and drugs, so stale entries stand out
--  * Medicare negotiated prices, shown beside each drug
--  * what the app reads inside new board documents (drugs mentioned, dates found)
--  * wording changes on the board pages it watches
--  * court cases about the boards, and new filings in them
-- and corrects the starting data against each board's own site (Oct 28, 2026).

-- ── When each entry was last checked against its source ─────────────
-- confirmed_by is empty when the check was part of setting the app up.
alter table public.drug_boards add column if not exists confirmed_at timestamptz;
alter table public.drug_boards add column if not exists confirmed_by uuid references auth.users(id) on delete set null;
alter table public.board_drugs add column if not exists confirmed_at timestamptz;
alter table public.board_drugs add column if not exists confirmed_by uuid references auth.users(id) on delete set null;

-- ── Medicare negotiated prices (published by CMS each November) ─────
create table if not exists public.medicare_prices (
  id text primary key,                     -- e.g. 'jardiance-2026'
  brand_names text[] not null,             -- every brand the price covers
  generic_name text not null,
  price_30_day numeric(12, 2) not null,    -- negotiated price for a 30-day supply
  list_price_30_day numeric(12, 2),        -- list price CMS compared it with
  list_price_year integer,
  effective_year integer not null,         -- the year the price takes effect
  source_url text not null
);
alter table public.medicare_prices enable row level security;
drop policy if exists "medicare prices readable by signed-in users" on public.medicare_prices;
create policy "medicare prices readable by signed-in users" on public.medicare_prices for select using (auth.role() = 'authenticated');

-- ── What the app reads inside new documents ─────────────────────────
alter table public.board_documents add column if not exists text_status text check (text_status in ('read', 'unreadable', 'skipped'));
alter table public.board_documents add column if not exists text_checked_at timestamptz;
alter table public.board_documents add column if not exists text_note text;   -- why it couldn't be read
alter table public.board_documents add column if not exists mentions text[] not null default '{}';
alter table public.board_documents add column if not exists mention_snippets jsonb not null default '[]'::jsonb;

-- Dates the app finds in documents land in the same calendar as the team's.
alter table public.board_dates add column if not exists source text not null default 'team';
alter table public.board_dates drop constraint if exists board_dates_source_check;
alter table public.board_dates add constraint board_dates_source_check check (source in ('team', 'document'));
alter table public.board_dates add column if not exists document_id uuid references public.board_documents(id) on delete cascade;
create unique index if not exists board_dates_document_once on public.board_dates (document_id, kind, date) where document_id is not null;

-- ── Wording changes on watched board pages ──────────────────────────
alter table public.board_pages add column if not exists page_text text;
alter table public.board_pages add column if not exists text_hash text;

create table if not exists public.board_page_changes (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.board_pages(id) on delete cascade,
  state text not null references public.drug_boards(state) on delete cascade,
  detected_at timestamptz not null default now(),
  ops jsonb,                               -- the redline, unchanged stretches folded; null if the page was rebuilt
  added integer not null default 0,
  removed integer not null default 0,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  notified_at timestamptz
);
create index if not exists board_page_changes_page_idx on public.board_page_changes (page_id, detected_at desc);
alter table public.board_page_changes enable row level security;
drop policy if exists "board page changes readable by signed-in users" on public.board_page_changes;
create policy "board page changes readable by signed-in users" on public.board_page_changes for select using (auth.role() = 'authenticated');
drop policy if exists "signed-in users can mark page changes reviewed" on public.board_page_changes;
create policy "signed-in users can mark page changes reviewed" on public.board_page_changes for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── Court cases about the boards ────────────────────────────────────
create table if not exists public.board_cases (
  id uuid primary key default gen_random_uuid(),
  state text not null references public.drug_boards(state) on delete cascade,
  board_drug_id uuid references public.board_drugs(id) on delete set null,
  name text not null,                      -- e.g. 'Amgen Inc. v. Mizner'
  court text not null,                     -- e.g. 'U.S. District Court for Colorado'
  court_code text,                         -- CourtListener's code, e.g. 'cod', 'cafc'
  docket_number text,
  courtlistener_id bigint,                 -- found automatically, or from a pasted link
  url text,                                -- where people can read the docket
  notes text,
  last_filing_date date,
  last_checked_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.board_cases enable row level security;
drop policy if exists "signed-in users manage board court cases" on public.board_cases;
create policy "signed-in users manage board court cases" on public.board_cases for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists public.board_case_filings (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.board_cases(id) on delete cascade,
  entry_key text not null,                 -- CourtListener entry id, or 'latest:<date>' when entries aren't available
  entry_number integer,
  date_filed date,
  description text,
  url text,
  first_seen_at timestamptz not null default now(),
  baseline boolean not null default false, -- already on the docket the first time we looked
  reviewed_at timestamptz,
  notified_at timestamptz,
  unique (case_id, entry_key)
);
create index if not exists board_case_filings_case_idx on public.board_case_filings (case_id, date_filed desc);
alter table public.board_case_filings enable row level security;
drop policy if exists "board case filings readable by signed-in users" on public.board_case_filings;
create policy "board case filings readable by signed-in users" on public.board_case_filings for select using (auth.role() = 'authenticated');
drop policy if exists "signed-in users can mark filings reviewed" on public.board_case_filings;
create policy "signed-in users can mark filings reviewed" on public.board_case_filings for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── Medicare negotiated prices, 30-day supply ───────────────────────
-- 2026: CMS fact sheet (Aug 2024). 2027: CMS fact sheet (Nov 2025).
insert into public.medicare_prices (id, brand_names, generic_name, price_30_day, list_price_30_day, list_price_year, effective_year, source_url) values
  ('eliquis-2026',   '{Eliquis}', 'apixaban', 231, 521, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('jardiance-2026', '{Jardiance}', 'empagliflozin', 197, 573, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('xarelto-2026',   '{Xarelto}', 'rivaroxaban', 197, 517, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('januvia-2026',   '{Januvia}', 'sitagliptin', 113, 527, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('farxiga-2026',   '{Farxiga}', 'dapagliflozin', 178.50, 556, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('entresto-2026',  '{Entresto}', 'sacubitril/valsartan', 295, 628, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('enbrel-2026',    '{Enbrel}', 'etanercept', 2355, 7106, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('imbruvica-2026', '{Imbruvica}', 'ibrutinib', 9319, 14934, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('stelara-2026',   '{Stelara}', 'ustekinumab', 4695, 13836, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('novolog-2026',   '{NovoLog,Fiasp}', 'insulin aspart', 119, 495, 2023, 2026, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'),
  ('semaglutide-2027', '{Ozempic,Wegovy,Rybelsus}', 'semaglutide', 274, 959, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('trelegy-2027',   '{"Trelegy Ellipta",Trelegy}', 'fluticasone furoate/umeclidinium/vilanterol', 175, 654, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('xtandi-2027',    '{Xtandi}', 'enzalutamide', 7004, 13480, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('pomalyst-2027',  '{Pomalyst}', 'pomalidomide', 8650, 21744, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('ofev-2027',      '{Ofev}', 'nintedanib', 6350, 12622, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('ibrance-2027',   '{Ibrance}', 'palbociclib', 7871, 15741, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('linzess-2027',   '{Linzess}', 'linaclotide', 136, 539, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('calquence-2027', '{Calquence}', 'acalabrutinib', 8600, 14228, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('austedo-2027',   '{Austedo,"Austedo XR"}', 'deutetrabenazine', 4093, 6623, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('breo-2027',      '{"Breo Ellipta",Breo}', 'fluticasone furoate/vilanterol', 67, 397, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('xifaxan-2027',   '{Xifaxan}', 'rifaximin', 1000, 2696, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('vraylar-2027',   '{Vraylar}', 'cariprazine', 770, 1376, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('tradjenta-2027', '{Tradjenta}', 'linagliptin', 78, 488, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('janumet-2027',   '{Janumet,"Janumet XR"}', 'sitagliptin/metformin', 80, 526, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf'),
  ('otezla-2027',    '{Otezla}', 'apremilast', 1650, 4722, 2024, 2027, 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-ipay-2027.pdf')
on conflict (id) do nothing;

-- ── Corrections from each board's own site, Oct 28, 2026 ────────────
-- Each one only touches entries nobody on the team has edited.

-- Maryland moved its site to pdab.maryland.gov, and its Jardiance and
-- Ozempic limits are still proposed regulations (none is active yet).
-- (Repeats the fix in the corrected 0005, for databases that ran the first copy.)
delete from public.board_pages where url like 'https://pdab.prod.maryland.gov/%';
insert into public.board_pages (state, url, label) values
  ('MD', 'https://pdab.maryland.gov/public-meetings/board-meetings', 'Board meetings'),
  ('MD', 'https://pdab.maryland.gov/cost-reviews/board-selected-drugs', 'Drugs under review'),
  ('MD', 'https://pdab.maryland.gov/upper-payment-limits', 'Upper payment limits'),
  ('MD', 'https://pdab.maryland.gov/about/regulations', 'Regulations')
on conflict (url) do nothing;
update public.drug_boards set
  website = 'https://pdab.maryland.gov/',
  summary = 'Voted in 2026 to limit what state and local government health plans pay for Jardiance and Ozempic. Both are still proposed regulations, so no limit is active yet. A 2025 law lets limits reach all Marylanders only after two have been in place for a year.',
  summary_source = 'https://pdab.maryland.gov/upper-payment-limits'
 where state = 'MD' and updated_by is null and website = 'https://pdab.prod.maryland.gov/';
update public.board_drugs set
  stage = 'limit_proposed',
  next_step = 'Final board vote after the Maryland Register comment period',
  source_url = 'https://pdab.maryland.gov/upper-payment-limits',
  notes = case drug
    when 'Jardiance' then 'Board voted in spring 2026 to set a limit for state and local government plans (about $320,000 a year in savings). Proposed regulations; earliest start January 1, 2027.'
    else 'Board voted May 2026 to set a limit for state and local government plans (about $5.8 million a year in savings). Proposed regulations; earliest start January 1, 2027.' end,
  needs_check = false
 where id in ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003') and updated_by is null and needs_check;
update public.board_drugs set
  source_url = 'https://marylandmatters.org/2026/05/19/board-votes-to-cap-how-much-state-local-governments-spend-on-ozempic/',
  notes = 'Found unaffordable in 2024 alongside Jardiance. The board held off on a limit after a generic was approved.',
  needs_check = false
 where id = 'c0000000-0000-4000-8000-000000000004' and updated_by is null and needs_check;
update public.drug_boards set
  summary = 'Set the first upper payment limit in the country, for Enbrel, in fall 2025, to start January 2027. A federal judge blocked it in July 2026; the state has appealed to the Federal Circuit.',
  summary_source = 'https://www.coloradopolitics.com/2026/07/27/colorado-board-permits-state-to-appeal-injunction-against-arthritis-drug-price-cap/',
  confirmed_at = '2026-10-28'
 where state = 'CO' and updated_by is null and confirmed_at is null;

update public.drug_boards set confirmed_at = '2026-10-28'
 where state = 'MD' and updated_by is null and confirmed_at is null;

update public.drug_boards set
  summary = 'Writing its drug cost review process; no reviews finished and no limits set yet. Its board meets next on November 10, 2026.',
  summary_source = 'https://mn.gov/commerce/insurance/health/pharmacy-drug-affordability-board/',
  confirmed_at = '2026-10-28'
 where state = 'MN' and updated_by is null and confirmed_at is null;

update public.drug_boards set
  summary = 'No limits set yet. In February 2026 the Health Care Authority began writing the rule for how the board will set upper payment limits (WSR 26-05-049); a proposed rule comes next.',
  summary_source = 'https://lawfilesext.leg.wa.gov/law/wsr/2026/05/26-05-049.htm',
  confirmed_at = '2026-10-28'
 where state = 'WA' and updated_by is null and confirmed_at is null;

update public.drug_boards set
  summary = 'Can''t cap prices. Reviews drug costs, and in November 2024 sent the Legislature its plan for how payment limits could work. Confirm whether lawmakers have acted on it.',
  summary_source = 'https://dfr.oregon.gov/pdab/Pages/upper-payment-limit-plan.aspx'
 where state = 'OR' and updated_by is null and confirmed_at is null;

update public.drug_boards set
  summary = 'Reviews drug spending for public payers and reports to the Legislature. A 2024 bill to let it set payment limits (LD 1829) didn''t become law; confirm whether a later one did.',
  summary_source = 'https://lldc.mainelegislature.org/Open/Meta/LegHist/131/lh131-LD-1829.pdf'
 where state = 'ME' and updated_by is null and confirmed_at is null;

update public.board_drugs set
  price_limit = '$600 per dose (about $31,000 a year)',
  next_step = 'State''s opening brief due at the Federal Circuit',
  next_date = '2026-11-04',
  source_url = 'https://dockets.justia.com/docket/circuit-courts/cafc/26-2111',
  notes = 'Set fall 2025 to start January 1, 2027. Judge Daniel Domenico (D. Colo.) blocked it with a preliminary injunction in July 2026. The board voted July 24 to appeal; the appeal is Amgen Inc. v. Mizner, Federal Circuit No. 26-2111.',
  needs_check = false,
  confirmed_at = '2026-10-28'
 where id = 'c0000000-0000-4000-8000-000000000001' and updated_by is null and confirmed_at is null;

update public.board_drugs set confirmed_at = '2026-10-28'
 where state = 'MD' and updated_by is null and confirmed_at is null and needs_check = false;

-- Minnesota's next meeting and comment deadline, from its board page.
insert into public.board_dates (id, state, date, time, kind, title, url) values
  ('d0000000-0000-4000-8000-000000000001', 'MN', '2026-11-06', null, 'comment_deadline', 'Comments due on the draft drug cost review outline', 'https://mn.gov/commerce/insurance/health/pharmacy-drug-affordability-board/'),
  ('d0000000-0000-4000-8000-000000000002', 'MN', '2026-11-10', '10:00 AM', 'meeting', 'Board meeting: draft drug cost review outline', 'https://mn.gov/commerce/insurance/health/pharmacy-drug-affordability-board/')
on conflict (id) do nothing;

-- The Enbrel case, in the district court and on appeal.
insert into public.board_cases (id, state, board_drug_id, name, court, court_code, docket_number, url, notes) values
  ('e0000000-0000-4000-8000-000000000001', 'CO', 'c0000000-0000-4000-8000-000000000001', 'Amgen Inc. v. Mizner', 'U.S. District Court for Colorado', 'cod', '1:25-cv-03452',
   'https://dockets.justia.com/docket/colorado/codce/1:2025cv03452/248711', 'Amgen''s challenge to the Enbrel limit. Preliminary injunction granted July 2026.'),
  ('e0000000-0000-4000-8000-000000000002', 'CO', 'c0000000-0000-4000-8000-000000000001', 'Amgen Inc. v. Mizner (appeal)', 'U.S. Court of Appeals for the Federal Circuit', 'cafc', '26-2111',
   'https://dockets.justia.com/docket/circuit-courts/cafc/26-2111', 'The state''s appeal of the injunction. Opening brief due November 4, 2026.')
on conflict (id) do nothing;

insert into public.schema_migrations (id, name)
values ('0006', 'Drug board accuracy')
on conflict (id) do nothing;

notify pgrst, 'reload schema';

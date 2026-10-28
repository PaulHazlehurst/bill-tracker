import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

export const dynamic = "force-dynamic";

// GET - everything the Drug boards page shows, in one request.
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  const { data: boards, error } = await supabase.from("drug_boards").select("*").order("sort");
  if (error) {
    return NextResponse.json({ ready: false, error: "Drug boards need a one-time database update. Run supabase/migrations/0005_drug_affordability_boards.sql in Supabase, SQL Editor." });
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const [pages, drugs, newDocs, recentDocs, dates, datedAgendas, bills, hiddenCount, me] = await Promise.all([
    supabase.from("board_pages").select("id, state, url, label, last_checked_at, last_changed_at, last_error").order("state"),
    supabase.from("board_drugs").select("*").order("updated_at", { ascending: false }),
    supabase.from("board_documents").select("id, state, url, title, kind, doc_date, first_seen_at").eq("baseline", false).is("reviewed_at", null).order("first_seen_at", { ascending: false }).limit(100),
    supabase.from("board_documents").select("id, state, url, title, kind, doc_date, first_seen_at, reviewed_at").order("doc_date", { ascending: false, nullsFirst: false }).limit(60),
    supabase.from("board_dates").select("*").gte("date", today).order("date").limit(60),
    supabase.from("board_documents").select("id, state, url, title, kind, doc_date").eq("kind", "agenda").gte("doc_date", today).order("doc_date").limit(30),
    supabase.from("state_bills").select("id, state, session, identifier, title, latest_action, latest_action_date, url, first_seen_at").eq("hidden", false).order("latest_action_date", { ascending: false, nullsFirst: false }).limit(150),
    supabase.from("state_bills").select("id", { count: "exact", head: true }).eq("hidden", true),
    supabase.from("profiles").select("drug_board_alerts, email_notifications_enabled").eq("id", user.id).maybeSingle(),
  ]);

  // Added by migration 0006. Until it's run, the page works without them.
  const [docExtras, changes, cases, filings, prices] = await Promise.all([
    supabase.from("board_documents").select("id, text_status, text_note, mentions, mention_snippets").eq("baseline", false).is("reviewed_at", null).order("first_seen_at", { ascending: false }).limit(100),
    supabase.from("board_page_changes").select("id, page_id, state, detected_at, ops, added, removed").is("reviewed_at", null).order("detected_at", { ascending: false }).limit(30),
    supabase.from("board_cases").select("*").order("created_at"),
    supabase.from("board_case_filings").select("id, case_id, date_filed, description, url, baseline, reviewed_at, first_seen_at").order("date_filed", { ascending: false, nullsFirst: false }).limit(200),
    supabase.from("medicare_prices").select("*").order("effective_year"),
  ]);
  const accuracy = !cases.error;
  const extras = new Map(((docExtras.data as any[]) ?? []).map((d) => [d.id, d]));
  const newDocuments = ((newDocs.data as any[]) ?? []).map((d) => ({ ...d, ...(extras.get(d.id) ?? {}) }));

  const checked = ((pages.data as any[]) ?? []).map((p) => p.last_checked_at).filter(Boolean).sort();
  return NextResponse.json({
    ready: true,
    today,
    boards: boards ?? [],
    pages: pages.data ?? [],
    drugs: drugs.data ?? [],
    newDocuments,
    recentDocuments: recentDocs.data ?? [],
    dates: dates.data ?? [],
    datedAgendas: datedAgendas.data ?? [],
    bills: bills.data ?? [],
    hiddenBills: hiddenCount.count ?? 0,
    lastChecked: checked.length ? checked[checked.length - 1] : null,
    alerts: { on: !!me.data?.drug_board_alerts, emailOn: !!me.data?.email_notifications_enabled },
    openStatesConfigured: !!process.env.OPEN_STATES_API_KEY,
    accuracy,
    pageChanges: accuracy ? changes.data ?? [] : [],
    cases: accuracy ? cases.data ?? [] : [],
    filings: accuracy ? filings.data ?? [] : [],
    medicarePrices: accuracy ? prices.data ?? [] : [],
    courtListenerConfigured: !!process.env.COURTLISTENER_API_TOKEN,
  });
}

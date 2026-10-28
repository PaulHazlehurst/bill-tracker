// SERVER-ONLY. The morning work for the Drug boards page:
//  1. Visit each board page we watch and record any document link we
//     haven't seen before (new agenda, minutes, report...). Nothing is
//     interpreted: the team reads the document and updates the drug
//     tracker, so every status traces back to the board's own words.
//  2. Ask Open States for state bills about drug affordability boards that
//     changed since the last run.
// Both are cheap (a dozen page loads, a few API calls) and resumable.

import { mapLimit, deadline, chunk, rotateByDay } from "@/lib/batch";
import { extractDocuments, parseDocDate, docKind, normalizeOpenStatesBill, isPublicWebUrl, STATE_NAMES, type StateBill } from "@/lib/drugBoards";

type Admin = any;

const PAGE_TIMEOUT_MS = 12_000;
const OPEN_STATES = "https://v3.openstates.org/bills";
const QUERIES = ["prescription drug affordability board", "upper payment limit prescription drug"];
const MAX_PAGES_PER_QUERY = 5;
const FIRST_RUN_DAYS = 540;
const OS_KEY = "open_states_bills";

function userAgent() {
  const app = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `Mozilla/5.0 (compatible; BillTracker/1.0${app ? `; +${app}` : ""})`;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = PAGE_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store", redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

export type PageCheckResult = { checked: number; newDocuments: number; errors: string[] };

export async function checkBoardPages(admin: Admin, budgetMs: number): Promise<PageCheckResult> {
  const clock = deadline(budgetMs);
  const { data: pages, error } = await admin.from("board_pages").select("id, state, url, last_checked_at").order("last_checked_at", { ascending: true, nullsFirst: true });
  if (error) throw new Error(`board pages unavailable: ${error.message}`);

  let checked = 0;
  let newDocuments = 0;
  const errors: string[] = [];

  await mapLimit((pages as any[]) ?? [], 4, async (page) => {
    if (clock.expired()) return;
    const now = new Date().toISOString();
    try {
      if (!isPublicWebUrl(page.url)) throw new Error("only public https web pages can be checked");
      const res = await fetchWithTimeout(page.url, { headers: { "User-Agent": userAgent(), Accept: "text/html,application/xhtml+xml" } });
      if (!res.ok) throw new Error(`the page returned ${res.status}`);
      // A redirect must also land on a public site.
      if (res.url && !isPublicWebUrl(res.url)) throw new Error("the page redirected somewhere that can't be checked");
      const html = await res.text();
      const found = extractDocuments(html, res.url || page.url);

      const known = new Set<string>();
      for (const urls of chunk(found.map((d) => d.url), 150)) {
        const { data } = await admin.from("board_documents").select("url").in("url", urls);
        for (const r of (data as any[]) ?? []) known.add(r.url);
      }
      const fresh = found.filter((d) => !known.has(d.url));
      // The first look at a page records what's already there without calling it new.
      const firstLook = !page.last_checked_at;
      if (fresh.length) {
        const rows = fresh.map((d) => ({
          state: page.state,
          page_id: page.id,
          url: d.url,
          title: d.title,
          kind: docKind(`${d.title} ${d.url}`),
          doc_date: parseDocDate(d.title) ?? parseDocDate(d.url),
          baseline: firstLook,
          notified_at: firstLook ? now : null,
        }));
        const { error: insertError } = await admin.from("board_documents").upsert(rows, { onConflict: "url", ignoreDuplicates: true });
        if (insertError) throw new Error(insertError.message);
        if (!firstLook) newDocuments += rows.length;
      }
      await admin.from("board_pages").update({ last_checked_at: now, last_error: null, ...(fresh.length && !firstLook ? { last_changed_at: now } : {}) }).eq("id", page.id);
      checked++;
    } catch (err: any) {
      const message = err?.name === "AbortError" ? "no response within 12 seconds" : String(err?.message ?? err);
      errors.push(`${page.state} ${page.url}: ${message}`);
      await admin.from("board_pages").update({ last_checked_at: now, last_error: message.slice(0, 300) }).eq("id", page.id);
    }
  });

  return { checked, newDocuments, errors: errors.slice(0, 10) };
}

export type BillSearchResult = { skipped?: string; requests: number; found: number; added: number; updated: number; complete: boolean; error?: string };

async function openStatesPage(params: Record<string, string>, key: string) {
  const url = new URL(OPEN_STATES);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchWithTimeout(url.toString(), { headers: { "X-API-KEY": key, Accept: "application/json" } }, 15_000);
  if (res.status === 429) return { rateLimited: true as const };
  if (!res.ok) return { error: `Open States returned ${res.status}: ${(await res.text()).slice(0, 160)}`, status: res.status };
  const body = await res.json();
  return { results: (body.results as any[]) ?? [], maxPage: Number(body.pagination?.max_page ?? 1) };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Daily search for state bills about drug affordability boards. */
export async function searchStateBills(admin: Admin, budgetMs: number): Promise<BillSearchResult> {
  const key = process.env.OPEN_STATES_API_KEY;
  if (!key) return { skipped: "OPEN_STATES_API_KEY isn't set", requests: 0, found: 0, added: 0, updated: 0, complete: false };
  const clock = deadline(budgetMs);
  const startedAt = new Date();
  const { data: state } = await admin.from("sync_state").select("cursor").eq("key", OS_KEY).maybeSingle();
  const since = state?.cursor ?? new Date(startedAt.getTime() - FIRST_RUN_DAYS * 86_400_000).toISOString().slice(0, 10);
  // The very first fill isn't news; neither is an old bill we only just came across.
  const { count: knownBills } = await admin.from("state_bills").select("id", { count: "exact", head: true });
  const firstRun = !knownBills;
  const recentCutoff = new Date(startedAt.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);

  const bills = new Map<string, StateBill>();
  let requests = 0;
  let complete = true;
  let error: string | undefined;

  // Search everywhere at once; if Open States insists on a state, fall back
  // to a rotating handful of states per day so all 50 are covered weekly.
  let perState: string[] | null = null;
  outer: for (const q of QUERIES) {
    for (let page = 1; page <= MAX_PAGES_PER_QUERY; page++) {
      if (clock.remainingMs() < 3_000) {
        complete = false;
        break outer;
      }
      if (requests) await pause(1_100);
      requests++;
      const r = await openStatesPage({ q, sort: "updated_desc", updated_since: since, per_page: "20", page: String(page) }, key);
      if ("rateLimited" in r) {
        complete = false;
        error = "Open States rate limit reached; the rest will be picked up next time";
        break outer;
      }
      if ("error" in r) {
        if (r.status === 400 && page === 1 && /jurisdiction/i.test(r.error ?? "")) {
          perState = rotateByDay(Object.keys(STATE_NAMES).filter((s) => s !== "DC")).slice(0, 8);
          break outer;
        }
        complete = false;
        error = r.error;
        break outer;
      }
      for (const raw of r.results) {
        const b = normalizeOpenStatesBill(raw);
        if (b) bills.set(b.id, b);
      }
      if (page >= r.maxPage) break;
    }
  }
  if (perState) {
    complete = false; // a rotation never covers everything in one run
    for (const st of perState) {
      for (const q of QUERIES) {
        if (clock.remainingMs() < 3_000) break;
        await pause(1_100);
        requests++;
        const r = await openStatesPage({ jurisdiction: st.toLowerCase(), q, sort: "updated_desc", updated_since: since, per_page: "20" }, key);
        if ("rateLimited" in r || "error" in r) continue;
        for (const raw of r.results) {
          const b = normalizeOpenStatesBill(raw);
          if (b) bills.set(b.id, b);
        }
      }
    }
  }

  const ids = Array.from(bills.keys());
  const existing = new Set<string>();
  for (const part of chunk(ids, 150)) {
    const { data } = await admin.from("state_bills").select("id").in("id", part);
    for (const r of (data as any[]) ?? []) existing.add(r.id);
  }
  const now = startedAt.toISOString();
  const inserts = ids.filter((id) => !existing.has(id)).map((id) => ({ ...bills.get(id)!, first_seen_at: now, updated_at: now, notified_at: firstRun || !bills.get(id)!.latest_action_date || bills.get(id)!.latest_action_date! < recentCutoff ? now : null }));
  const updates = ids.filter((id) => existing.has(id)).map((id) => bills.get(id)!);
  for (const part of chunk(inserts, 100)) {
    const { error: e } = await admin.from("state_bills").insert(part);
    if (e) throw new Error(`couldn't save state bills: ${e.message}`);
  }
  for (const b of updates) {
    await admin.from("state_bills").update({ title: b.title, latest_action: b.latest_action, latest_action_date: b.latest_action_date, url: b.url, session: b.session, updated_at: now }).eq("id", b.id);
  }
  // Only move the window forward after a complete run, so nothing is skipped.
  if (complete) {
    await admin.from("sync_state").upsert({ key: OS_KEY, cursor: new Date(startedAt.getTime() - 86_400_000).toISOString().slice(0, 10), last_run_at: now });
  }
  return { requests, found: bills.size, added: inserts.length, updated: updates.length, complete, error };
}

/** Both jobs within a time budget. Skips quietly until migration 0005 has been run. */
export async function syncDrugBoards(admin: Admin, budgetMs: number) {
  const { error: notReady } = await admin.from("drug_boards").select("state").limit(1);
  if (notReady) return { skipped: "Drug board tables not set up yet (supabase/migrations/0005_drug_affordability_boards.sql)" };
  const clock = deadline(budgetMs);
  const pages = await checkBoardPages(admin, Math.floor(budgetMs * 0.6)).catch((e) => ({ error: String(e?.message ?? e) }));
  const bills = await searchStateBills(admin, Math.max(4_000, clock.remainingMs())).catch((e) => ({ error: String(e?.message ?? e) }));
  return { pages, bills };
}

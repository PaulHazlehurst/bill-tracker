// SERVER-ONLY. The closer reading added in migration 0006:
//  1. Open each new board document (PDF or web page), note which tracked
//     drugs it names, and add any meeting dates or comment deadlines it
//     states to the Coming up calendar.
//  2. Check court cases about the boards for new filings, via CourtListener.
// Runs in the morning alert job (before the email goes out) and from
// "Check boards now". Both parts are resumable: anything not reached is
// picked up on the next run.

import { deadline } from "@/lib/batch";
import { isPublicWebUrl } from "@/lib/drugBoards";
import {
  pageText, findMentions, findEventDates, drugTerms, normalizeDocketEntry, COURTLISTENER, type MedicarePrice, type Filing,
} from "@/lib/boardReading";

type Admin = any;

const DOC_TIMEOUT_MS = 15_000;
const MAX_DOC_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 80;
const DOCS_PER_RUN = 8;
const READ_WINDOW_DAYS = 45;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store", redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

function userAgent() {
  const app = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `Mozilla/5.0 (compatible; BillTracker/1.0${app ? `; +${app}` : ""})`;
}

/** Text of a PDF. Loaded only when needed: the PDF reader is the largest piece of the app. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      const parts: string[] = [];
      for (let i = 1; i <= MAX_PDF_PAGES; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        parts.push(content.items.map((it: any) => ("str" in it ? it.str : "")).join(" "));
      }
      return parts.join("\n");
    }
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } finally {
    await (pdf as any).destroy?.().catch?.(() => {});
  }
}

class Unreadable extends Error {}

async function documentText(url: string): Promise<string> {
  if (!isPublicWebUrl(url)) throw new Unreadable("only public https documents can be opened");
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": userAgent(), Accept: "application/pdf,text/html;q=0.9,*/*;q=0.5" } }, DOC_TIMEOUT_MS);
  if (res.url && !isPublicWebUrl(res.url)) throw new Unreadable("it redirected somewhere that can't be opened");
  if (res.status >= 400 && res.status < 500) throw new Unreadable(`the board's site returned ${res.status}`);
  if (!res.ok) throw new Error(`the board's site returned ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_DOC_BYTES) throw new Unreadable("it's too large to open (over 15 MB)");
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_DOC_BYTES) throw new Unreadable("it's too large to open (over 15 MB)");
  const isPdf = type.includes("pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46); // %PDF
  if (isPdf) {
    try {
      return await pdfText(bytes);
    } catch (err: any) {
      throw new Unreadable(`the PDF couldn't be read (${String(err?.message ?? err).slice(0, 80)})`);
    }
  }
  if (type.includes("html") || type.startsWith("text/")) return pageText(new TextDecoder().decode(bytes));
  throw new Unreadable("it's not a PDF or web page (Word and Excel files aren't opened)");
}

export type ReadResult = { read: number; unreadable: number; mentions: number; datesAdded: number; left: number };

export async function readNewDocuments(admin: Admin, budgetMs: number): Promise<ReadResult> {
  const clock = deadline(budgetMs);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const since = new Date(Date.now() - READ_WINDOW_DAYS * 86_400_000).toISOString();
  const retryAfter = new Date(Date.now() - 20 * 3_600_000).toISOString();
  const { data: docs, error } = await admin
    .from("board_documents")
    .select("id, state, url, title, kind")
    .is("text_status", null)
    .eq("baseline", false)
    .gte("first_seen_at", since)
    .or(`text_checked_at.is.null,text_checked_at.lt.${retryAfter}`)
    .order("first_seen_at", { ascending: true })
    .limit(DOCS_PER_RUN);
  if (error) throw new Error(`board documents unavailable: ${error.message}`);
  const queue = (docs as any[]) ?? [];
  const result: ReadResult = { read: 0, unreadable: 0, mentions: 0, datesAdded: 0, left: 0 };
  if (!queue.length) return result;

  const [{ data: drugs }, { data: prices }] = await Promise.all([
    admin.from("board_drugs").select("drug"),
    admin.from("medicare_prices").select("*"),
  ]);
  const terms = drugTerms((drugs as any[]) ?? [], (prices as MedicarePrice[]) ?? []);

  for (const doc of queue) {
    if (clock.remainingMs() < DOC_TIMEOUT_MS + 2_000) {
      result.left++;
      continue;
    }
    const now = new Date().toISOString();
    try {
      const text = await documentText(doc.url);
      if (text.replace(/\s+/g, "").length < 40) throw new Unreadable("there's no text in it (it may be a scanned image)");
      const found = findMentions(text, terms);
      await admin
        .from("board_documents")
        .update({ text_status: "read", text_checked_at: now, text_note: null, mentions: found.map((m) => m.term), mention_snippets: found })
        .eq("id", doc.id);
      result.read++;
      result.mentions += found.length;

      for (const e of findEventDates(text, { kind: doc.kind, today })) {
        const { data: same } = await admin.from("board_dates").select("id").eq("state", doc.state).eq("date", e.date).eq("kind", e.kind).limit(1);
        if ((same as any[])?.length) continue;
        const { error: insertError } = await admin.from("board_dates").insert({
          state: doc.state, date: e.date, time: e.time, kind: e.kind, title: e.title, url: doc.url, source: "document", document_id: doc.id,
        });
        if (!insertError) result.datesAdded++;
      }
    } catch (err: any) {
      const message = err?.name === "AbortError" ? "no response within 15 seconds" : String(err?.message ?? err);
      // A broken link or a scanned page won't fix itself; a slow site might.
      const final = err instanceof Unreadable;
      await admin
        .from("board_documents")
        .update({ text_status: final ? "unreadable" : null, text_checked_at: now, text_note: message.slice(0, 300) })
        .eq("id", doc.id);
      if (final) result.unreadable++;
      else result.left++;
    }
  }
  return result;
}

// ── Court cases ───────────────────────────────────────────────────────

export type CaseResult = { checked: number; newFilings: number; errors: string[] };

async function courtListener(path: string) {
  const token = process.env.COURTLISTENER_API_TOKEN;
  const res = await fetchWithTimeout(`${COURTLISTENER}${path}`, { headers: { Accept: "application/json", "User-Agent": userAgent(), ...(token ? { Authorization: `Token ${token}` } : {}) } }, 12_000);
  if (res.status === 401 || res.status === 403) return { denied: true as const, status: res.status };
  if (res.status === 429) throw new Error("CourtListener's rate limit was reached; it'll try again tomorrow");
  if (!res.ok) throw new Error(`CourtListener returned ${res.status}`);
  return { body: await res.json() };
}

export async function checkCourtCases(admin: Admin, budgetMs: number): Promise<CaseResult> {
  const clock = deadline(budgetMs);
  const { data: cases, error } = await admin.from("board_cases").select("*").order("last_checked_at", { ascending: true, nullsFirst: true });
  if (error) throw new Error(`court cases unavailable: ${error.message}`);
  const result: CaseResult = { checked: 0, newFilings: 0, errors: [] };
  const hasToken = !!process.env.COURTLISTENER_API_TOKEN;

  for (const c of (cases as any[]) ?? []) {
    if (clock.remainingMs() < 4_000) break;
    const now = new Date().toISOString();
    try {
      let id: number | null = c.courtlistener_id ? Number(c.courtlistener_id) : null;
      if (!id) {
        if (!c.court_code || !c.docket_number) throw new Error("Paste the case's CourtListener link to follow it");
        const found = await courtListener(`/api/rest/v4/dockets/?court=${encodeURIComponent(c.court_code)}&docket_number=${encodeURIComponent(c.docket_number)}`);
        if ("denied" in found) throw new Error(hasToken ? "CourtListener refused the token" : "CourtListener needs a free API token: add COURTLISTENER_API_TOKEN in Vercel");
        id = found.body?.results?.[0]?.id ?? null;
        if (!id) throw new Error("Not on CourtListener yet. If you find it there, paste its link into the case");
        await admin.from("board_cases").update({ courtlistener_id: id }).eq("id", c.id);
      }

      const docket = await courtListener(`/api/rest/v4/dockets/${id}/`);
      if ("denied" in docket) throw new Error(hasToken ? "CourtListener refused the token" : "CourtListener needs a free API token: add COURTLISTENER_API_TOKEN in Vercel");
      const docketUrl = docket.body?.absolute_url ? `${COURTLISTENER}${docket.body.absolute_url}` : `${COURTLISTENER}/docket/${id}/`;
      const lastFiling: string | null = docket.body?.date_last_filing ?? null;

      let filings: Filing[] = [];
      let detailed = false;
      const entries = await courtListener(`/api/rest/v4/docket-entries/?docket=${id}&order_by=-date_filed`).catch(() => null);
      if (entries && "body" in entries) {
        detailed = true;
        filings = ((entries.body?.results as any[]) ?? []).map((e) => normalizeDocketEntry(e, docketUrl)).filter(Boolean) as Filing[];
      } else if (lastFiling) {
        // Entry details need extra access on CourtListener; the date of the
        // latest filing still says something happened.
        filings = [{ entry_key: `latest:${lastFiling}`, entry_number: null, date_filed: lastFiling, description: "New filing on the docket", url: docketUrl }];
      }

      // The first successful look records what's already on the docket
      // without calling it new (also when entry details first become available).
      const { data: earlier } = await admin.from("board_case_filings").select("entry_key").eq("case_id", c.id).limit(50);
      const earlierKeys = ((earlier as any[]) ?? []).map((e) => e.entry_key as string);
      const firstLook = !earlierKeys.length || (detailed && earlierKeys.every((k) => k.startsWith("latest:")));
      if (filings.length) {
        const rows = filings.map((f) => ({ ...f, case_id: c.id, baseline: firstLook, notified_at: firstLook ? now : null, first_seen_at: now }));
        const { data: known } = await admin.from("board_case_filings").select("entry_key").eq("case_id", c.id).in("entry_key", rows.map((r) => r.entry_key));
        const have = new Set(((known as any[]) ?? []).map((k) => k.entry_key));
        const fresh = rows.filter((r) => !have.has(r.entry_key));
        if (fresh.length) {
          const { error: insertError } = await admin.from("board_case_filings").insert(fresh);
          if (insertError) throw new Error(insertError.message);
          if (!firstLook) result.newFilings += fresh.length;
        }
      }
      await admin.from("board_cases").update({ last_checked_at: now, last_error: null, last_filing_date: lastFiling ?? c.last_filing_date, courtlistener_id: id }).eq("id", c.id);
      result.checked++;
    } catch (err: any) {
      const message = err?.name === "AbortError" ? "CourtListener didn't respond within 12 seconds" : String(err?.message ?? err);
      result.errors.push(`${c.name}: ${message}`);
      await admin.from("board_cases").update({ last_checked_at: now, last_error: message.slice(0, 300) }).eq("id", c.id);
    }
  }
  return result;
}

/** Both, within a time budget. Skips quietly until migration 0006 has been run. */
export async function syncBoardReading(admin: Admin, budgetMs: number) {
  const { error: notReady } = await admin.from("board_cases").select("id").limit(1);
  if (notReady) return { skipped: "Run supabase/migrations/0006_drug_board_accuracy.sql to turn on document reading and court cases" };
  const clock = deadline(budgetMs);
  const courts = await checkCourtCases(admin, Math.min(10_000, Math.floor(budgetMs * 0.35))).catch((e) => ({ error: String(e?.message ?? e) }));
  const documents = await readNewDocuments(admin, clock.remainingMs()).catch((e) => ({ error: String(e?.message ?? e) }));
  return { documents, courts };
}

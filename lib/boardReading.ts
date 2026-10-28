// Reading what drug affordability boards publish, more closely. Pure (no
// I/O), so every rule here is tested in tests/boardReading.test.ts.
//
//  * pageText / pageChange: the words on a board page, and whether they
//    changed in a way worth a person's attention (not a timestamp ticking).
//  * findMentions: which tracked drugs a new document names, with the
//    sentence around it.
//  * findEventDates: meeting dates and comment deadlines written in a
//    document, for the Coming up calendar.
//  * matchMedicarePrice: the Medicare negotiated price for a tracked drug.
//  * checkAge: how long since someone confirmed an entry.
//  * CourtListener helpers for court cases about the boards.
//
// Plain rules and word matching only; nothing is guessed or generated.

import { decodeEntities } from "@/lib/houseFloor";
import { tokenize, myersDiff, foldOps, type Op } from "@/lib/textDiff";

// ── Page wording ──────────────────────────────────────────────────────

const MAX_PAGE_TEXT = 120_000;

/** The readable words of a page: the main content if marked, without menus, scripts or footers. */
export function pageText(html: string): string {
  let h = html;
  const main = h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main) h = main[1];
  else {
    const body = h.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
    if (body) h = body[1];
  }
  h = h
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe|template|button)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(h).replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT);
}

/** A short fingerprint so unchanged pages are skipped without diffing. FNV-1a, 32-bit. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export type PageChange = { ops: Op[] | null; added: number; removed: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const DATEISH = /^(\d[\d,.:/-]*|a\.?m\.?|p\.?m\.?|am|pm|et|est|edt|ct|pt|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?)$/i;

/**
 * What changed between two readings of a page, or null if nothing worth
 * showing did. Ignored: text that is just the title of a document link found
 * on the same run (that's reported as a new document already), and small
 * changes made only of dates, times and numbers (counters, "last updated").
 */
export function pageChange(oldText: string, newText: string, ignoreTitles: string[] = []): PageChange | null {
  if (oldText === newText) return null;
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const ops = myersDiff(a, b, 1500);
  if (!ops) return { ops: null, added: b.length, removed: a.length }; // the page was rebuilt
  const ignored = ignoreTitles.map(norm).filter((t) => t.length > 3);
  let added = 0;
  let removed = 0;
  let meaningful = 0;
  for (const op of ops) {
    if (op.t !== "ins" && op.t !== "del") continue;
    const words = tokenize(op.s);
    if (op.t === "ins") added += words.length;
    else removed += words.length;
    const n = norm(op.s);
    if (!n) continue;
    if (ignored.some((t) => t.includes(n) || n.includes(t))) continue;
    if (words.length <= 4 && words.every((w) => DATEISH.test(w))) continue;
    meaningful += words.length;
  }
  if (!meaningful) return null;
  return { ops: foldOps(ops, 10), added, removed };
}

// ── Drugs named in a document ─────────────────────────────────────────

export type Term = { label: string; words: string[] };
export type Mention = { term: string; snippet: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function snippetAround(text: string, start: number, end: number, reach = 110) {
  let from = Math.max(0, start - reach);
  let to = Math.min(text.length, end + reach);
  if (from > 0) from = text.indexOf(" ", from) + 1 || from;
  if (to < text.length) to = text.lastIndexOf(" ", to) > end ? text.lastIndexOf(" ", to) : to;
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}

/** Which terms appear in the text (whole words, any case), each with the passage around its first appearance. */
export function findMentions(text: string, terms: Term[]): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    if (seen.has(t.label.toLowerCase())) continue;
    let best: RegExpExecArray | null = null;
    for (const w of t.words) {
      if (w.trim().length < 3) continue;
      const m = new RegExp(`(?<![A-Za-z0-9])${escapeRe(w.trim()).replace(/\s+/g, "\\s+")}(?![A-Za-z0-9])`, "i").exec(text);
      if (m && (!best || m.index < best.index)) best = m;
    }
    if (best) {
      seen.add(t.label.toLowerCase());
      out.push({ term: t.label, snippet: snippetAround(text, best.index, best.index + best[0].length) });
    }
  }
  return out;
}

/** Search terms for the drugs on the tracker, with generic names from the Medicare list where known. */
export function drugTerms(drugs: { drug: string }[], prices: MedicarePrice[]): Term[] {
  const terms = new Map<string, Term>();
  for (const d of drugs) {
    const label = d.drug.trim();
    if (!label) continue;
    const words = new Set([label]);
    const price = matchMedicarePrice(label, prices);
    if (price) words.add(price.generic_name);
    const key = label.toLowerCase();
    if (terms.has(key)) for (const w of words) terms.get(key)!.words.push(w);
    else terms.set(key, { label, words: Array.from(words) });
  }
  return Array.from(terms.values());
}

// ── Dates written in a document ───────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RE = /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/gi;
const TIME_RE = /^[\s,]*(?:at\s+|from\s+|beginning at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|noon)/i;

type FoundDate = { date: string; index: number; end: number };

function isoDate(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const m of Array.from(text.matchAll(DATE_RE))) {
    const date = m[1]
      ? isoDate(+m[3], MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, +m[2])
      : isoDate(+m[6], +m[4], +m[5]);
    if (date) out.push({ date, index: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

function timeAfter(text: string, at: number): string | null {
  const m = TIME_RE.exec(text.slice(at, at + 40));
  if (!m) return null;
  if (/noon/i.test(m[3])) return "12:00 PM";
  return `${+m[1]}:${m[2] ?? "00"} ${/p/i.test(m[3]) ? "PM" : "AM"}`;
}

export type EventDate = { kind: "meeting" | "hearing" | "comment_deadline"; date: string; time: string | null; title: string };

/**
 * Meeting dates and comment deadlines a document states outright:
 *  - an agenda or notice's own meeting date, read from its opening lines
 *  - "the next meeting is <date>"
 *  - "comments ... due / received by / no later than <date>"
 * Only dates from today up to about a year out are kept.
 */
export function findEventDates(text: string, opts: { kind: string | null; today: string }): EventDate[] {
  const horizon = new Date(Date.parse(opts.today) + 400 * 86_400_000).toISOString().slice(0, 10);
  const dates = findDates(text).filter((d) => d.date >= opts.today && d.date <= horizon);
  const out: EventDate[] = [];
  const add = (e: EventDate) => {
    if (!out.some((x) => x.kind === e.kind && x.date === e.date)) out.push(e);
  };
  const opening = text.slice(0, 500);
  const isMeetingDoc = opts.kind === "agenda" || opts.kind === "notice" || /\b(agenda|meeting|hearing)\b/i.test(opening);
  let usedOpening = false;
  for (const d of dates) {
    const before = text.slice(Math.max(0, d.index - 160), d.index);
    const near = text.slice(Math.max(0, d.index - 70), d.index);
    if (/comment/i.test(before) && /\b(due|deadlines?|received|submit\w*|no later than|until|ends?|closes?|by)\b\W*(\w+\W+){0,3}$/i.test(before)) {
      add({ kind: "comment_deadline", date: d.date, time: timeAfter(text, d.end), title: "Comments due" });
    } else if (/next\s+(board\s+|regular\s+|public\s+)?meeting/i.test(near)) {
      add({ kind: "meeting", date: d.date, time: timeAfter(text, d.end), title: "Board meeting" });
    } else if (isMeetingDoc && !usedOpening && d.index < 500) {
      usedOpening = true;
      const hearing = /\bhearing\b/i.test(opening) && !/\bmeeting\b/i.test(opening);
      add({ kind: hearing ? "hearing" : "meeting", date: d.date, time: timeAfter(text, d.end), title: hearing ? "Public hearing" : "Board meeting" });
    }
  }
  return out;
}

// ── Medicare negotiated prices ────────────────────────────────────────

export type MedicarePrice = {
  id: string;
  brand_names: string[];
  generic_name: string;
  price_30_day: number | string;
  list_price_30_day: number | string | null;
  list_price_year: number | null;
  effective_year: number;
  source_url: string;
};

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The Medicare negotiated price for a drug name as the team typed it ("Ozempic", "Enbrel (etanercept)"). Latest year wins. */
export function matchMedicarePrice(drug: string, prices: MedicarePrice[]): MedicarePrice | null {
  const k = ` ${key(drug)} `;
  if (!k.trim()) return null;
  const hits = prices.filter((p) => [...p.brand_names, p.generic_name].some((n) => k.includes(` ${key(n)} `)));
  return hits.sort((a, b) => b.effective_year - a.effective_year)[0] ?? null;
}

export function formatUsd(n: number | string): string {
  const v = Number(n);
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

// ── How long since someone confirmed an entry ─────────────────────────

export const STALE_AFTER_DAYS = 30;

export function checkAge(confirmedAt: string | null, now = new Date()): { label: string; stale: boolean; days: number | null } {
  if (!confirmedAt) return { label: "Not checked yet", stale: true, days: null };
  const days = Math.floor((now.getTime() - Date.parse(confirmedAt)) / 86_400_000);
  const label = days < 1 ? "Checked today" : days === 1 ? "Checked yesterday" : `Checked ${days} days ago`;
  return { label, stale: days > STALE_AFTER_DAYS, days };
}

// ── CourtListener ─────────────────────────────────────────────────────

export const COURTLISTENER = "https://www.courtlistener.com";

/** The docket id from a CourtListener link, e.g. https://www.courtlistener.com/docket/69510553/amgen-v-mizner/ */
export function parseCourtListenerUrl(raw: string): number | null {
  const m = raw.match(/^https:\/\/(?:www\.)?courtlistener\.com\/docket\/(\d+)(?:\/|$)/i);
  return m ? Number(m[1]) : null;
}

export type Filing = { entry_key: string; entry_number: number | null; date_filed: string | null; description: string; url: string };

export function normalizeDocketEntry(raw: any, docketUrl: string): Filing | null {
  if (!raw || raw.id == null) return null;
  const n = Number.isFinite(Number(raw.entry_number)) && raw.entry_number !== null ? Number(raw.entry_number) : null;
  const text = String(raw.description || raw.recap_documents?.[0]?.description || "").replace(/\s+/g, " ").trim();
  return {
    entry_key: String(raw.id),
    entry_number: n,
    date_filed: typeof raw.date_filed === "string" ? raw.date_filed.slice(0, 10) : null,
    description: (text || (n != null ? `Docket entry ${n}` : "New docket entry")).slice(0, 600),
    url: n != null ? `${docketUrl}#entry-${n}` : docketUrl,
  };
}

export type CaseFields = {
  state?: string; name?: string; court?: string; court_code?: string | null; docket_number?: string | null;
  courtlistener_id?: number | null; url?: string | null; notes?: string | null; board_drug_id?: string | null;
};

/**
 * Cleans what someone typed when adding or editing a court case. A
 * CourtListener link is all that's needed to follow a case; otherwise the
 * court's CourtListener code and the docket number let the app find it.
 */
export function cleanCaseInput(body: Record<string, unknown>): { fields: CaseFields; error?: string } {
  const fields: CaseFields = {};
  const str = (k: string, max: number) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : undefined);
  const state = str("state", 2);
  if (state !== undefined) {
    if (!/^[A-Za-z]{2}$/.test(state)) return { fields, error: "Pick a state." };
    fields.state = state.toUpperCase();
  }
  const name = str("name", 200);
  if (name !== undefined) fields.name = name;
  const court = str("court", 160);
  if (court !== undefined) fields.court = court;
  const notes = str("notes", 1500);
  if (notes !== undefined) fields.notes = notes || null;
  if (fields.name === "") return { fields, error: "Name the case, e.g. Amgen Inc. v. Mizner." };
  const code = str("court_code", 12);
  if (code !== undefined) {
    if (code && !/^[a-z0-9]{2,12}$/i.test(code)) return { fields, error: "The court code is CourtListener's short code, like cod or cafc." };
    fields.court_code = code.toLowerCase() || null;
  }
  const docket = str("docket_number", 40);
  if (docket !== undefined) fields.docket_number = docket || null;
  if (typeof body.board_drug_id === "string" || body.board_drug_id === null) {
    const id = body.board_drug_id as string | null;
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) return { fields, error: "Unknown drug." };
    fields.board_drug_id = id || null;
  }
  const link = str("link", 500);
  if (link !== undefined) {
    if (!link) fields.url = null;
    else {
      if (!/^https:\/\//i.test(link)) return { fields, error: "Links should start with https://" };
      const cl = parseCourtListenerUrl(link);
      if (cl) fields.courtlistener_id = cl;
      fields.url = link;
    }
  }
  return { fields };
}

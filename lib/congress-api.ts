// SERVER-ONLY. Never import this from a "use client" component — the API
// key is read from a non-NEXT_PUBLIC_ env var specifically so that's impossible
// to do by accident without Next.js throwing at build time.

import { trackedFetch } from "@/lib/apiUsageTracker";
import { inferStageFromText, progressForStage as stageProgress } from "@/lib/billStage";

const BASE_URL = "https://api.congress.gov/v3";

function apiKey() {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) throw new Error("CONGRESS_API_KEY is not set");
  return key;
}

export async function getBill(congress: number, billType: string, billNumber: number | string) {
  const url = new URL(`${BASE_URL}/bill/${congress}/${billType.toLowerCase()}/${billNumber}`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) throw new Error(`congress.gov detail fetch failed: ${res.status}`);
  return res.json(); // { bill: {...} }
}

export type SearchResult = {
  congress: number;
  type: string;
  number: string;
  title: string;
  /** Plain-English reasons this bill matched, e.g. 'Title mentions "telehealth"'. */
  reasons?: string[];
  /** Higher = stronger match. Only meaningful for ranking within one search. */
  score?: number;
  /** Latest action / publish date when the source provided one (YYYY-MM-DD). */
  date?: string | null;
};

const BILL_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"];
// Ceremonial/procedural resolutions - kept out of discovery, ranked last in search.
export const RESOLUTION_TYPES = new Set(["hres", "sres", "hconres", "sconres"]);

function billKey(r: { type: string; number: string | number; congress: number }) {
  return `${String(r.type).toLowerCase()}-${r.number}-${r.congress}`;
}

// ── Query parsing ────────────────────────────────────────────────────
// Turns whatever someone typed into something every source can use. Strips
// characters that are syntax in GovInfo's query language (quotes, colons,
// parentheses) so a topic like `"340B" drug pricing` can't break the query.
export function normalizeQuery(q: string) {
  const cleaned = q.replace(/[“”"():\[\]{}\\]/g, " ").replace(/\s+/g, " ").trim();
  const words = cleaned
    .toLowerCase()
    .split(" ")
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  return { cleaned, words };
}

const STOP_WORDS = new Set(["a", "an", "the", "of", "and", "or", "for", "to", "in", "on", "act", "bill"]);

// Light stemming so "hospitals" matches "hospital" and "prescriptions"
// matches "prescription" in title scans. Deliberately conservative - it
// only trims common English plural/-ing endings.
function stem(w: string) {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("es") && /(ss|sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 6 && w.endsWith("ing")) return w.slice(0, -3);
  return w;
}

function textMatchesAll(text: string, words: string[]) {
  const t = text.toLowerCase();
  return words.every((w) => t.includes(stem(w)));
}

/** Recognises "HR 1234", "H.R. 1234", "S.123", "hjres 45" and so on. */
export function parseCitation(q: string): { type: string; number: string } | null {
  const compact = q.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  const m = compact.match(/^(h ?r|s|h ?j ?res|s ?j ?res|h ?con ?res|s ?con ?res|h ?res|s ?res)\s*0*(\d{1,5})$/);
  if (!m) return null;
  const type = m[1].replace(/\s/g, "");
  return BILL_TYPES.includes(type) ? { type, number: m[2] } : null;
}

// ── Source 1: congress.gov "recently updated" list, scanned by title ─────
// congress.gov's API has no keyword search. The best it offers is the list
// of bills sorted by most recent update, which we scan by title. Its value
// is recency: brand-new bills show up here days before GovInfo publishes
// their text. The list is fetched ONCE and shared by every topic in a run
// (it used to be re-downloaded for every single topic).
type RecentBill = { congress: number; type: string; number: string; title: string; actionText: string; actionDate: string | null };
const recentCache = new Map<string, { at: number; bills: RecentBill[] }>();
const RECENT_TTL_MS = 10 * 60_000;

export async function getRecentlyUpdatedBills(congress = 119, pages = 2): Promise<RecentBill[]> {
  const cacheKey = `${congress}:${pages}`;
  const hit = recentCache.get(cacheKey);
  if (hit && Date.now() - hit.at < RECENT_TTL_MS) return hit.bills;

  const pageNums = Array.from({ length: Math.max(1, pages) }, (_, i) => i);
  const results = await Promise.all(
    pageNums.map(async (page) => {
      const url = new URL(`${BASE_URL}/bill/${congress}`);
      url.searchParams.set("api_key", apiKey());
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "250"); // congress.gov's max page size
      url.searchParams.set("offset", String(page * 250));
      url.searchParams.set("sort", "updateDate+desc");
      const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
      if (!res.ok) throw new Error(`congress.gov bill list failed: ${res.status}`);
      const data = await res.json();
      return (data.bills ?? []) as any[];
    }),
  );
  // Pages can overlap if bills update mid-fetch, so de-duplicate.
  const seenRecent = new Set<string>();
  const unique = results.flat().filter((b: any) => {
    const k = `${b.type}-${b.number}`;
    if (seenRecent.has(k)) return false;
    seenRecent.add(k);
    return true;
  });
  const bills: RecentBill[] = unique.map((b: any) => ({
    congress: b.congress,
    type: String(b.type ?? "").toUpperCase(),
    number: String(b.number),
    title: b.title ?? "",
    actionText: b.latestAction?.text ?? "",
    actionDate: b.latestAction?.actionDate ?? null,
  }));
  recentCache.set(cacheKey, { at: Date.now(), bills });
  return bills;
}

// ── Source 2: GovInfo, which indexes the real text of every bill ──────
// GovInfo's query language (confirmed against govinfo.gov/features/
// search-service-overview and /help/finding-info): terms are AND-ed by
// default, `title:` restricts to the title field, `publishdate:range(a,)`
// filters by date, and `resultLevel: "package"` returns one row per bill
// version rather than a mix of granules. One bill has several versions
// (ih, rh, eh, enr...), so rows are de-duplicated by bill.
function govinfoKey() {
  return process.env.GOVINFO_API_KEY || process.env.CONGRESS_API_KEY || "DEMO_KEY";
}

type GovInfoOpts = { congress: number; pageSize?: number; sort?: "score" | "publishdate"; sinceDays?: number };

async function govinfoBillSearch(query: string, opts: GovInfoOpts): Promise<(SearchResult & { date: string | null })[]> {
  let q = `${query} collection:BILLS congress:${opts.congress}`;
  if (opts.sinceDays) {
    const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString().slice(0, 10);
    q += ` publishdate:range(${since},)`;
  }
  const body = {
    query: q,
    pageSize: String(Math.min(100, opts.pageSize ?? 60)),
    offsetMark: "*",
    resultLevel: "package",
    sorts: [{ field: opts.sort ?? "score", sortOrder: "DESC" }],
  };
  const res = await trackedFetch(
    `https://api.govinfo.gov/search?api_key=${govinfoKey()}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" },
    "govinfo_gov",
  );
  if (!res.ok) throw new Error(`govinfo search failed: ${res.status}`);
  const data = await res.json();

  const seen = new Set<string>();
  const out: (SearchResult & { date: string | null })[] = [];
  for (const row of data.results ?? []) {
    // packageId like "BILLS-119hr1247ih" -> congress 119, type HR, number 1247
    const m = String(row.packageId ?? "").match(/^BILLS-(\d+)([a-z]+?)(\d+)([a-z]*)$/i);
    if (!m) continue;
    const [, cong, type, number] = m;
    if (!BILL_TYPES.includes(type.toLowerCase())) continue;
    const r = { congress: Number(cong), type: type.toUpperCase(), number: String(Number(number)), title: row.title ?? `${type.toUpperCase()} ${number}`, date: row.dateIssued ?? null };
    const k = billKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// ── The unified, ranked search ───────────────────────────────────────
// Runs several complementary passes in parallel and merges them with a
// score, so the bills most clearly ABOUT the topic come first:
//   title match in GovInfo      +6   (high precision)
//   title match on congress.gov +6   (and catches brand-new bills)
//   exact phrase in bill text   +3
//   all words in bill text      +1   (broad safety net)
//   published in last 120 days  +2   (fresh activity)
//   earlier position in a relevance-sorted list adds a small bonus
// Real laws-to-be (HR, S, joint resolutions) outrank ceremonial resolutions.
//
// `failed` lists the passes that errored, so callers can tell "nothing
// matched" apart from "the source was down". Only throws if EVERY pass fails.
export type RankedSearch = { results: SearchResult[]; failed: string[]; passes: number };

export async function searchBillsRanked(
  query: string,
  opts: { congress?: number; recentPages?: number; limit?: number } = {},
): Promise<RankedSearch> {
  const congress = opts.congress ?? 119;
  const limit = opts.limit ?? 40;
  const { cleaned, words } = normalizeQuery(query);
  if (!cleaned) return { results: [], failed: [], passes: 0 };

  const merged = new Map<string, SearchResult & { score: number; reasons: string[] }>();
  const add = (r: SearchResult & { date?: string | null }, points: number, reason: string) => {
    const k = billKey(r);
    const cur = merged.get(k);
    if (cur) {
      cur.score += points;
      if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
      if (!cur.date && r.date) cur.date = r.date;
      // Prefer congress.gov's display title over GovInfo's long official one.
      if (reason.startsWith("Recently active") && r.title) cur.title = r.title;
    } else {
      merged.set(k, { ...r, score: points, reasons: [reason], date: r.date ?? null });
    }
  };

  // A citation is a direct lookup - always exact, never depends on search.
  const citation = parseCitation(cleaned);
  if (citation) {
    try {
      const raw = await getBill(congress, citation.type, citation.number);
      if (raw?.bill) {
        return {
          results: [{
            congress: raw.bill.congress,
            type: raw.bill.type,
            number: String(raw.bill.number),
            title: raw.bill.title,
            reasons: ["Exact bill number"],
            score: 100,
            date: raw.bill.latestAction?.actionDate ?? null,
          }],
          failed: [],
          passes: 1,
        };
      }
    } catch {
      // Not a bill in this Congress - fall through to keyword search.
    }
  }

  const label = `"${cleaned}"`;
  const titleTerms = words.length ? words.join(" AND ") : cleaned;
  const phrase = words.length > 1 ? `"${cleaned}"` : cleaned;
  const failed: string[] = [];

  const passes: [string, Promise<void>][] = [
    ["govinfo-title", govinfoBillSearch(`title:(${titleTerms})`, { congress, pageSize: 60 }).then((rows) =>
      rows.forEach((r, i) => add(r, 6 + Math.max(0, 2 - i / 15), `Title mentions ${label}`)))],
    ["govinfo-phrase", govinfoBillSearch(phrase, { congress, pageSize: 60 }).then((rows) =>
      rows.forEach((r, i) => add(r, (words.length > 1 ? 3 : 2) + Math.max(0, 1.5 - i / 20), `Bill text mentions ${label}`)))],
    ["govinfo-recent", govinfoBillSearch(phrase, { congress, pageSize: 40, sort: "publishdate", sinceDays: 120 }).then((rows) =>
      rows.forEach((r) => add(r, 2, "Published in the last 4 months")))],
    ["congress-recent", getRecentlyUpdatedBills(congress, opts.recentPages ?? 2).then((bills) => {
      for (const b of bills) {
        if (words.length && textMatchesAll(b.title, words)) {
          add({ congress: b.congress, type: b.type, number: b.number, title: b.title, date: b.actionDate }, 6, `Title mentions ${label}`);
          add({ congress: b.congress, type: b.type, number: b.number, title: b.title, date: b.actionDate }, 1, "Recently active in Congress");
        } else if (words.length && textMatchesAll(b.actionText, words)) {
          add({ congress: b.congress, type: b.type, number: b.number, title: b.title, date: b.actionDate }, 2, "Latest action mentions it");
        }
      }
    })],
  ];

  if (words.length > 1) {
    // Broad net: every word anywhere in the text, not necessarily together.
    passes.push(["govinfo-allwords", govinfoBillSearch(words.join(" AND "), { congress, pageSize: 40 }).then((rows) =>
      rows.forEach((r) => add(r, 1, "Bill text mentions every word")))]);
  }

  const settled = await Promise.allSettled(passes.map(([, p]) => p));
  settled.forEach((s, i) => {
    if (s.status === "rejected") {
      failed.push(passes[i][0]);
      console.error(`search pass ${passes[i][0]} failed for "${cleaned}"`, s.reason);
    }
  });
  if (failed.length === passes.length) throw new Error("all search sources failed");

  const results = Array.from(merged.values())
    .map((r) => ({ ...r, score: RESOLUTION_TYPES.has(r.type.toLowerCase()) ? r.score - 4 : r.score }))
    .sort((a, b) => b.score - a.score || String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, limit);

  return { results, failed, passes: passes.length };
}

/** Back-compat wrapper: same shape older callers expect. */
export async function searchBillsSmart(query: string, congress = 119, recentPages = 1): Promise<SearchResult[]> {
  const { results } = await searchBillsRanked(query, { congress, recentPages, limit: 30 });
  return results;
}

export type RelatedBill = {
  congress: number;
  type: string;
  number: string;
  title: string;
  latestActionText: string | null;
  relationshipType: string | null;
};

// Fetches companion/related bills (e.g. the Senate version of a House
// bill), as identified by CRS, the House, or the Senate. Only called when
// someone actually opens a bill's detail page - not part of the batch
// poller - so the extra request cost is bounded by real usage, not
// multiplied across every tracked bill on every poll cycle.
export async function getRelatedBills(congress: number, billType: string, billNumber: number | string): Promise<RelatedBill[]> {
  const url = new URL(`${BASE_URL}/bill/${congress}/${billType.toLowerCase()}/${billNumber}/relatedbills`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) throw new Error(`congress.gov related bills fetch failed: ${res.status}`);
  const data = await res.json();

  return (data.relatedBills ?? []).map((b: any) => ({
    congress: b.congress,
    type: b.type,
    number: String(b.number),
    title: b.title,
    latestActionText: b.latestAction?.text ?? null,
    relationshipType: b.relationshipDetails?.[0]?.type ?? null,
  }));
}

export type BillAction = {
  actionDate: string;
  text: string;
  type: string | null;
  actionCode: string | null;
  chamber: string | null;
  hasRecordedVote: boolean;
  voteUrl: string | null;
};

// Fetches the FULL action history for a bill - not just the latest action
// we already store. This is what makes a real "vote history" possible:
// our own bill_events log only captures whatever the once-daily poller
// happened to catch, but this endpoint has every recorded action congress.gov
// has, including votes that happened between poll cycles or before this
// bill was ever tracked. Called on-demand (bill detail page) and cached in
// the bills table - see /api/bills/actions.
export async function getBillActions(congress: number, billType: string, billNumber: number | string): Promise<BillAction[]> {
  const url = new URL(`${BASE_URL}/bill/${congress}/${billType.toLowerCase()}/${billNumber}/actions`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "250");

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) throw new Error(`congress.gov actions fetch failed: ${res.status}`);
  const data = await res.json();

  return (data.actions ?? []).map((a: any) => ({
    actionDate: a.actionDate,
    text: a.text,
    type: a.type ?? null,
    actionCode: a.actionCode != null ? String(a.actionCode) : null,
    chamber: a.sourceSystem?.name ?? null,
    hasRecordedVote: Array.isArray(a.recordedVotes) && a.recordedVotes.length > 0,
    voteUrl: Array.isArray(a.recordedVotes) && a.recordedVotes[0]?.url ? a.recordedVotes[0].url : null,
  }));
}

export type CosponsorBreakdown = { D: number; R: number; I: number; total: number; capped: boolean };

// Party split of cosponsors - requires a separate API call from the main
// bill fetch (congress.gov's bill detail only gives a cosponsor COUNT, not
// the party of each one). Fetches up to 250 (congress.gov's max page size);
// if a bill has more than that, `capped` is true and the breakdown is a
// representative sample rather than exhaustive - disclosed in the UI rather
// than silently presented as complete.
export async function getCosponsorBreakdown(congress: number, billType: string, billNumber: number | string): Promise<CosponsorBreakdown> {
  const url = new URL(`${BASE_URL}/bill/${congress}/${billType.toLowerCase()}/${billNumber}/cosponsors`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "250");

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) throw new Error(`congress.gov cosponsors fetch failed: ${res.status}`);
  const data = await res.json();

  const list = data.cosponsors ?? [];
  const totalAvailable = data.pagination?.count ?? list.length;
  const counts: CosponsorBreakdown = { D: 0, R: 0, I: 0, total: 0, capped: totalAvailable > list.length };

  for (const c of list) {
    const party = (c.party ?? "").toUpperCase();
    if (party === "D") counts.D++;
    else if (party === "R") counts.R++;
    else counts.I++;
    counts.total++;
  }

  return counts;
}

export type CommitteeActivity = {
  committeeName: string;
  chamber: string;
  activities: { date: string; name: string }[];
};

// The reliable, cheap layer: official dated history of committee activity
// on a bill - "Hearings by X Committee on 2025-04-02", "Markup by...", etc.
// No matching/guessing involved, so no risk of attaching the wrong hearing
// to the wrong bill.
export async function getCommitteeActivity(congress: number, billType: string, billNumber: number | string): Promise<CommitteeActivity[]> {
  const url = new URL(`${BASE_URL}/bill/${congress}/${billType.toLowerCase()}/${billNumber}/committees`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "100");

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) throw new Error(`congress.gov committees fetch failed: ${res.status}`);
  const data = await res.json();

  return (data.committees ?? []).map((c: any) => ({
    committeeName: c.name,
    chamber: c.chamber,
    activities: (c.activities ?? []).map((a: any) => ({ date: a.date, name: a.name })),
  }));
}

type CommitteeMeetingListItem = { eventId: string; url: string };

async function listCommitteeMeetingsOnDate(congress: number, chamber: string, date: string): Promise<CommitteeMeetingListItem[]> {
  // congress.gov's list endpoint takes a datetime range, not an exact-date
  // filter, so we ask for just that one calendar day.
  const url = new URL(`${BASE_URL}/committee-meeting/${congress}/${chamber.toLowerCase()}`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "50");
  url.searchParams.set("fromDateTime", `${date}T00:00:00Z`);
  url.searchParams.set("toDateTime", `${date}T23:59:59Z`);

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) return [];
  const data = await res.json();
  return (data.committeeMeetings ?? []).map((m: any) => ({ eventId: m.eventId, url: m.url }));
}

export type HearingDetail = {
  date: string;
  committeeName: string;
  title: string | null;
  meetingType: string | null;
  location: string | null;
  witnesses: {
    name: string;
    position: string | null;
    organization: string | null;
    // The closest thing to "what this witness actually said" that's
    // realistically available close to when the hearing happens - the full
    // official transcript typically takes 3 months to 2 years to publish,
    // at each committee's discretion, so it's not something a live feature
    // can depend on. Prepared statements are often posted within days.
    statementUrl: string | null;
  }[];
  videoUrl: string | null;
  documents: { name: string; description: string | null; type: string | null; url: string | null }[];
};

async function getCommitteeMeetingDetail(url: string): Promise<any> {
  const withKey = new URL(url);
  withKey.searchParams.set("api_key", apiKey());
  withKey.searchParams.set("format", "json");
  const res = await trackedFetch(withKey.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) return null;
  const data = await res.json();
  return data.committeeMeeting ?? null;
}

// The richer, more expensive layer. For each "Hearings by" date we already
// confirmed via getCommitteeActivity, this looks for the SPECIFIC committee
// meeting record and only accepts a match if that record's own related-bills
// list actually names this bill - not a guess based on matching committee
// name and date alone. Capped (maxHearings, per-day candidate limit) so a
// bill with an unusually long hearing history can't trigger a runaway
// number of requests; only the most recent hearings get the rich-detail
// treatment, older ones still show up via the plain date/committee history.
export async function findMatchingHearingDetails(
  congress: number,
  billType: string,
  billNumber: number | string,
  committeeActivity: CommitteeActivity[],
  maxHearings = 3
): Promise<HearingDetail[]> {
  const hearingDates: { date: string; chamber: string; committeeName: string }[] = [];
  for (const c of committeeActivity) {
    for (const a of c.activities) {
      if (a.name === "Hearings by") {
        hearingDates.push({ date: a.date, chamber: c.chamber, committeeName: c.committeeName });
      }
    }
  }
  // Most recent first - if there are more hearings than our cap, prioritize
  // the ones someone's actually likely to care about right now.
  hearingDates.sort((a, b) => (a.date < b.date ? 1 : -1));
  const toCheck = hearingDates.slice(0, maxHearings);

  const results: HearingDetail[] = [];

  for (const h of toCheck) {
    const chamberForApi = h.chamber === "Joint" ? "house" : h.chamber.toLowerCase(); // committee-meeting endpoint doesn't have a "joint" path
    const candidates = await listCommitteeMeetingsOnDate(congress, chamberForApi, h.date);

    for (const candidate of candidates.slice(0, 5)) { // bound worst-case detail fetches for a single busy day
      const detail = await getCommitteeMeetingDetail(candidate.url);
      if (!detail) continue;

      const relatedBills = detail.relatedItems?.bills ?? detail.relatedItems?.bill ?? [];
      const isMatch = (Array.isArray(relatedBills) ? relatedBills : [relatedBills]).some(
        (b: any) => b && Number(b.congress) === Number(congress) &&
          (b.type ?? "").toLowerCase() === billType.toLowerCase() &&
          Number(b.number) === Number(billNumber)
      );
      if (!isMatch) continue;

      results.push({
        date: h.date,
        committeeName: h.committeeName,
        title: detail.title ?? null,
        meetingType: detail.type ?? null,
        location: detail.location?.building && detail.location?.room
          ? `${detail.location.building}, Room ${detail.location.room}`
          : null,
        witnesses: (detail.witnesses ?? []).map((w: any) => {
          const docs = Array.isArray(w.witnessDocuments) ? w.witnessDocuments : [];
          const statement = docs.find((d: any) => (d.documentType ?? "").toLowerCase().includes("statement")) ?? docs[0];
          return {
            name: w.name ?? "Unknown",
            position: w.position ?? null,
            organization: w.organization ?? null,
            statementUrl: statement?.url ?? null,
          };
        }),
        videoUrl: detail.videos?.[0]?.url ?? null,
        documents: (detail.meetingDocuments ?? []).map((d: any) => ({
          name: d.name ?? "Document",
          description: d.description ?? null,
          type: d.documentType ?? d.type ?? null,
          url: d.url ?? null,
        })),
      });
      break; // found the match for this date, no need to check remaining candidates
    }
  }

  return results;
}

export type BillSummary = { text: string; actionDesc: string; actionDate: string; updateDate: string };

// Official CRS-authored plain-language summaries. Same service, same key,
// nothing new to configure - this was just an endpoint we hadn't used yet.
// A bill can have several summaries over its life (one per version, e.g.
// "Introduced in House" vs "Reported to Senate") - returns all of them,
// most recent first, so the UI can show the latest and let someone expand
// earlier ones if the bill has changed substantially.
export async function getBillSummaries(congress: number, billType: string, billNumber: number | string): Promise<BillSummary[]> {
  const url = new URL(`${BASE_URL}/bill/${congress}/${billType.toLowerCase()}/${billNumber}/summaries`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "20");

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) throw new Error(`congress.gov summaries fetch failed: ${res.status}`);
  const data = await res.json();

  return (data.summaries ?? [])
    .map((s: any) => ({
      text: (s.text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), // CRS summaries come as HTML - strip tags for plain display
      actionDesc: s.actionDesc ?? "",
      actionDate: s.actionDate ?? "",
      updateDate: s.updateDate ?? "",
    }))
    .sort((a: BillSummary, b: BillSummary) => (a.actionDate < b.actionDate ? 1 : -1));
}

export type TextVersion = { type: string; date: string | null; formats: { type: string; url: string }[] };

// The actual legislative text - not the plain-language CRS summary, the
// real bill language. A bill can have several versions over its life
// (Introduced, Reported, Engrossed, Enrolled...), each with its own set of
// formats (PDF, HTML, sometimes XML). Confirmed real against congress.gov's
// own changelog documentation (date/type/formats fields), same service and
// key as everything else here.
export async function getBillTextVersions(congress: number, billType: string, billNumber: number | string): Promise<TextVersion[]> {
  const url = new URL(`${BASE_URL}/bill/${congress}/${billType.toLowerCase()}/${billNumber}/text`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "20");

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) throw new Error(`congress.gov text fetch failed: ${res.status}`);
  const data = await res.json();

  return (data.textVersions ?? []).map((v: any) => ({
    type: v.type ?? "Text",
    date: v.date ?? null,
    formats: (v.formats ?? []).map((f: any) => ({ type: f.type ?? "Link", url: f.url })).filter((f: any) => f.url),
  }));
}

// ── Member / legislator endpoints ──────────────────────────────────

export type MemberSummary = {
  bioguideId: string;
  name: string;
  party: string;
  state: string;
  district: string | null;
  chamber: string;
  imageUrl: string | null;
  url: string | null;
};

// The full roster of current members of Congress (~540). congress.gov caps
// a page at 250, so this fetches three pages in parallel. It used to ask for
// just 50, which meant the directory and its search could only ever find
// about a tenth of Congress. Cached for 12 hours - the roster rarely changes.
let rosterCache: { at: number; members: MemberSummary[] } | null = null;
const ROSTER_TTL_MS = 12 * 3_600_000;

const STATE_ABBR: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia", PR: "Puerto Rico", GU: "Guam", VI: "Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
};

function parseMember(m: any): MemberSummary {
  const terms = m.terms?.item ?? m.terms ?? [];
  const term = [...(Array.isArray(terms) ? terms : [])].sort((a: any, b: any) => (b.startYear ?? 0) - (a.startYear ?? 0))[0];
  return {
    bioguideId: m.bioguideId,
    name: m.name ?? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim(),
    party: (m.partyName ?? m.party ?? term?.party ?? "").charAt(0).toUpperCase() || "?",
    state: m.state ?? term?.state ?? "",
    district: m.district != null ? String(m.district) : term?.district ? String(term.district) : null,
    chamber: String(term?.chamber ?? "").replace("House of Representatives", "House"),
    imageUrl: m.depiction?.imageUrl ?? null,
    url: m.url ?? null,
  };
}

export async function searchMembers(query?: string, _congress = 119, _limit = 0): Promise<MemberSummary[]> {
  if (!rosterCache || Date.now() - rosterCache.at > ROSTER_TTL_MS) {
    const pages = await Promise.all(
      [0, 250, 500].map(async (offset) => {
        const url = new URL(`${BASE_URL}/member`);
        url.searchParams.set("api_key", apiKey());
        url.searchParams.set("format", "json");
        url.searchParams.set("limit", "250");
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("currentMember", "true");
        const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
        if (!res.ok) throw new Error(`congress.gov members fetch failed: ${res.status}`);
        const data = await res.json();
        return (data.members ?? []) as any[];
      }),
    );
    const seen = new Set<string>();
    const members = pages.flat().map(parseMember).filter((m) => m.bioguideId && !seen.has(m.bioguideId) && seen.add(m.bioguideId));
    members.sort((a, b) => a.state.localeCompare(b.state) || a.chamber.localeCompare(b.chamber) || a.name.localeCompare(b.name));
    rosterCache = { at: Date.now(), members };
  }

  let members = rosterCache.members;
  if (query) {
    const q = query.trim().toLowerCase();
    const stateFromAbbr = STATE_ABBR[query.trim().toUpperCase()]?.toLowerCase();
    members = members.filter((m) =>
      m.name.toLowerCase().includes(q) || m.state.toLowerCase().includes(q) || (stateFromAbbr && m.state.toLowerCase() === stateFromAbbr),
    );
  }
  return members;
}

export function stateAbbreviation(stateName: string): string | null {
  const hit = Object.entries(STATE_ABBR).find(([, name]) => name.toLowerCase() === stateName.toLowerCase());
  return hit ? hit[0] : null;
}

export type MemberDetail = MemberSummary & {
  officialUrl: string | null;
  phone: string | null;
  office: string | null;
  servingSince: number | null;
  yearsInOffice: number | null;
  leadershipRoles: string[];
  sponsoredLegislation: { count: number; url: string | null };
  cosponsoredLegislation: { count: number; url: string | null };
};

// Fetch a single member by bioguide ID.
export async function getMember(bioguideId: string): Promise<MemberDetail | null> {
  const url = new URL(`${BASE_URL}/member/${bioguideId}`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) return null;
  const data = await res.json();
  const m = data.member;
  if (!m) return null;

  const terms = m.terms ?? [];
  const term = [...terms].sort((a: any, b: any) => (b.startYear ?? 0) - (a.startYear ?? 0))[0];

  // Seniority: earliest term start year across all terms served. A quick,
  // honest signal of how established a member is - a 20-year veteran and a
  // freshman carry very different weight in a whip count.
  const startYears = terms.map((t: any) => t.startYear).filter((y: any) => typeof y === "number");
  const servingSince = startYears.length ? Math.min(...startYears) : null;
  const nowYear = new Date().getFullYear();
  const yearsInOffice = servingSince ? Math.max(0, nowYear - servingSince) : null;

  // Leadership roles (Majority Leader, Whip, etc.) when congress.gov reports
  // them - these are exactly the people who control whether a bill moves.
  const leadershipRoles: string[] = Array.from(
    new Set(((m.leadership ?? []) as any[]).map((l) => l.type).filter(Boolean)),
  );

  return {
    bioguideId: m.bioguideId,
    name: m.directOrderName ?? m.invertedOrderName ?? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim(),
    party: (m.partyHistory?.[0]?.partyName ?? term?.partyName ?? "").charAt(0).toUpperCase() || "?",
    state: m.state ?? term?.stateCode ?? "",
    district: term?.district ? String(term.district) : null,
    chamber: (term?.chamber ?? "").replace("House of Representatives", "House"),
    imageUrl: m.depiction?.imageUrl ?? null,
    url: m.url ?? null,
    officialUrl: m.officialWebsiteUrl ?? null,
    phone: m.addressInformation?.phoneNumber ?? null,
    office: m.addressInformation?.officeAddress ?? null,
    servingSince,
    yearsInOffice,
    leadershipRoles,
    sponsoredLegislation: {
      count: m.sponsoredLegislation?.count ?? 0,
      url: m.sponsoredLegislation?.url ?? null,
    },
    cosponsoredLegislation: {
      count: m.cosponsoredLegislation?.count ?? 0,
      url: m.cosponsoredLegislation?.url ?? null,
    },
  };
}

// Fetch bills sponsored by a member (limited set for the profile page).
export type MemberBill = {
  congress: number;
  type: string;
  number: string;
  title: string;
  latestActionText: string | null;
  latestActionDate: string | null;
};

export async function getMemberBills(bioguideId: string, type: "sponsored" | "cosponsored" = "sponsored", limit = 20): Promise<MemberBill[]> {
  const endpoint = type === "sponsored" ? "sponsored-legislation" : "cosponsored-legislation";
  const url = new URL(`${BASE_URL}/member/${bioguideId}/${endpoint}`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");
  // Over-fetch, since amendments in the list are dropped below.
  url.searchParams.set("limit", String(Math.min(250, limit * 3)));

  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) return [];
  const data = await res.json();

  // These lists mix bills with AMENDMENTS, which have no bill type or bill
  // number. Unfiltered, they crashed the member profile page (any code
  // calling b.type.toLowerCase()) for nearly every senator.
  return (data.sponsoredLegislation ?? data.cosponsoredLegislation ?? [])
    .filter((b: any) => b && b.type && b.number != null)
    .slice(0, limit)
    .map((b: any) => ({
    congress: b.congress,
    type: b.type,
    number: String(b.number),
    title: b.title ?? "",
    latestActionText: b.latestAction?.text ?? null,
    latestActionDate: b.latestAction?.actionDate ?? null,
  }));
}

// Stage logic lives in lib/billStage.ts (shared with the client). These
// wrappers keep older imports working.

export function inferStage(latestActionText: string, billType = "hr"): string {
  return inferStageFromText(latestActionText, billType);
}

export function progressForStage(stage: string): number {
  return stageProgress(stage);
}

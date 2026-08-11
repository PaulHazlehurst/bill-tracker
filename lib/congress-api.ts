// SERVER-ONLY. Never import this from a "use client" component — the API
// key is read from a non-NEXT_PUBLIC_ env var specifically so that's impossible
// to do by accident without Next.js throwing at build time.

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

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`congress.gov detail fetch failed: ${res.status}`);
  return res.json(); // { bill: {...} }
}

export type SearchResult = {
  congress: number;
  type: string;
  number: string;
  title: string;
};

// NOTE: congress.gov's public API doesn't offer true full-text keyword search
// on the bill list endpoint the way a search engine would. This does a
// best-effort listing filtered client-side by title match, which is fine for
// an MVP but worth revisiting against the latest API docs before you scale
// search usage - see https://api.congress.gov/ for current endpoints.
// NOTE: congress.gov's public API does NOT offer full-text/keyword search -
// there's no `q` parameter on the bill list endpoint. This does the best
// available approximation: pull a large batch of the most recently updated
// bills and match titles against the query words. That means very old or
// long-dormant bills that haven't been touched recently may not show up
// even if their title matches - a fundamental limitation of the public API,
// not a bug in this code. See https://api.congress.gov/ for the source of
// truth if this ever changes.
export async function searchBills(query: string, congress = 119): Promise<SearchResult[]> {
  // Shortcut: if the query looks like a bill citation ("hr 1234", "s1234",
  // "HJRES 45"), fetch that exact bill directly. This is 100% reliable
  // regardless of the "recently updated" window limitation above, since it's
  // a direct lookup rather than a filtered list scan.
  const citation = query.trim().toLowerCase().match(
    /^(hr|s|hjres|sjres|hconres|sconres|hres|sres)\s*0*(\d+)$/
  );
  if (citation) {
    const [, type, number] = citation;
    try {
      const raw = await getBill(congress, type, number);
      if (raw?.bill) {
        return [{
          congress: raw.bill.congress,
          type: raw.bill.type,
          number: String(raw.bill.number),
          title: raw.bill.title,
        }];
      }
    } catch {
      // Fall through to the keyword search below - the citation might just
      // not exist in this congress, or might be a genuine keyword like "sres".
    }
  }

  const url = new URL(`${BASE_URL}/bill/${congress}`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "250"); // congress.gov's max page size
  url.searchParams.set("sort", "updateDate+desc");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`congress.gov search failed: ${res.status}`);
  const data = await res.json();

  // Match if every word in the query appears somewhere in the title -
  // more forgiving than requiring the exact phrase in the exact order.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (data.bills ?? [])
    .filter((b: any) => {
      const title = (b.title ?? "").toLowerCase();
      return words.every((w: string) => title.includes(w));
    })
    .slice(0, 20)
    .map((b: any) => ({
      congress: b.congress,
      type: b.type,
      number: String(b.number),
      title: b.title,
    }));
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

  const res = await fetch(url.toString(), { cache: "no-store" });
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
  hasRecordedVote: boolean;
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

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`congress.gov actions fetch failed: ${res.status}`);
  const data = await res.json();

  return (data.actions ?? []).map((a: any) => ({
    actionDate: a.actionDate,
    text: a.text,
    type: a.type ?? null,
    hasRecordedVote: Array.isArray(a.recordedVotes) && a.recordedVotes.length > 0,
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

  const res = await fetch(url.toString(), { cache: "no-store" });
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

  const res = await fetch(url.toString(), { cache: "no-store" });
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

  const res = await fetch(url.toString(), { cache: "no-store" });
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
  witnesses: { name: string; position: string | null; organization: string | null }[];
  videoUrl: string | null;
  documents: { name: string; description: string | null; type: string | null; url: string | null }[];
};

async function getCommitteeMeetingDetail(url: string): Promise<any> {
  const withKey = new URL(url);
  withKey.searchParams.set("api_key", apiKey());
  withKey.searchParams.set("format", "json");
  const res = await fetch(withKey.toString(), { cache: "no-store" });
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
        witnesses: (detail.witnesses ?? []).map((w: any) => ({
          name: w.name ?? "Unknown",
          position: w.position ?? null,
          organization: w.organization ?? null,
        })),
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

  const res = await fetch(url.toString(), { cache: "no-store" });
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

export function inferStage(latestActionText: string): string {
  const text = (latestActionText ?? "").toLowerCase();
  if (text.includes("became public law") || text.includes("signed by president")) return "enacted";
  if (text.includes("vetoed")) return "vetoed";
  if (text.includes("presented to president")) return "to_president";
  if (text.includes("passed senate")) return "passed_senate";
  if (text.includes("passed house") || text.includes("passed/agreed to in house")) return "passed_house";
  if (text.includes("committee")) return "committee";
  return "introduced";
}

export function progressForStage(stage: string): number {
  const map: Record<string, number> = {
    introduced: 10,
    committee: 30,
    passed_house: 55,
    passed_senate: 70,
    to_president: 85,
    enacted: 100,
    vetoed: 100,
    failed: 100,
  };
  return map[stage] ?? 10;
}

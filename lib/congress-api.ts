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

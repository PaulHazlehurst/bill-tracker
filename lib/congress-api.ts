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
export async function searchBills(query: string, congress = 119): Promise<SearchResult[]> {
  const url = new URL(`${BASE_URL}/bill/${congress}`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "50");
  url.searchParams.set("sort", "updateDate+desc");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`congress.gov search failed: ${res.status}`);
  const data = await res.json();

  const needle = query.toLowerCase();
  return (data.bills ?? [])
    .filter((b: any) => (b.title ?? "").toLowerCase().includes(needle))
    .slice(0, 15)
    .map((b: any) => ({
      congress: b.congress,
      type: b.type,
      number: String(b.number),
      title: b.title,
    }));
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

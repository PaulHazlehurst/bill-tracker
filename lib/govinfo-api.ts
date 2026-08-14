// SERVER-ONLY. GovInfo's Search Service - lets us search the Congressional
// Record (floor speeches, remarks, extensions of remarks) for mentions of a
// specific bill. This is the real answer to "what did a representative say
// about this bill" - official, verbatim, attributable text, not a news
// summary or an AI's paraphrase of one.
//
// Two honest caveats:
// 1. GovInfo's own documentation calls this Search Service a "public
//    preview" - not yet full production status, so the exact response
//    shape or behavior could change. Coded defensively (optional chaining
//    throughout) for that reason.
// 2. This runs on the same api.data.gov key as congress.gov, and api.data.gov
//    tracks rate limits per-key across ALL of its participating APIs - so
//    these calls likely draw from the same quota bucket as every
//    congress.gov call this app makes, not a separate one. Tracked here
//    under its own "govinfo_gov" label on the API Usage page for clarity,
//    but be aware it's probably not truly additive headroom.

import { trackedFetch } from "@/lib/apiUsageTracker";

function apiKey() {
  const key = process.env.CONGRESS_API_KEY; // same api.data.gov key, no separate GovInfo key needed
  if (!key) throw new Error("CONGRESS_API_KEY is not set");
  return key;
}

export type RecordMention = {
  title: string;
  date: string | null;
  section: string | null; // House, Senate, Extensions of Remarks
  url: string | null;
};

export async function searchCongressionalRecord(billCitation: string, congress: number): Promise<RecordMention[]> {
  const url = `https://api.govinfo.gov/search?api_key=${apiKey()}`;
  const body = {
    query: `collection:CREC AND congress:${congress} AND "${billCitation}"`,
    pageSize: "10",
    offsetMark: "*",
    sorts: [{ field: "score", sortOrder: "DESC" }],
  };

  const res = await trackedFetch(
    url,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" },
    "govinfo_gov"
  );
  if (!res.ok) throw new Error(`GovInfo search failed: ${res.status}`);
  const data = await res.json();

  const results = data.results ?? [];
  return results.slice(0, 10).map((r: any) => ({
    title: r.title ?? "Congressional Record entry",
    date: r.dateIssued ?? null,
    section: r.section ?? null,
    url: r.download?.pdfLink ?? r.download?.txtLink ?? r.granuleLink ?? null,
  }));
}

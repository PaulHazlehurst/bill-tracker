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
  snippet: string | null;
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
  return results.slice(0, 10).map((r: any) => {
    // The API's own download links (pdfLink, txtLink) require an api_key
    // query param to resolve - fine for our server to fetch, but not safe
    // or correct to hand to a person as a clickable link (that would mean
    // exposing our API key in a URL they could see, copy, or share).
    // GovInfo's public website has its own no-key-required "details" page
    // for the same content, built from the package/granule ID - that's
    // what we actually want to link to.
    const packageId = r.packageId ?? r.package?.packageId ?? null;
    const granuleId = r.granuleId ?? null;
    const publicUrl = packageId
      ? `https://www.govinfo.gov/app/details/${packageId}${granuleId ? `/${granuleId}` : ""}`
      : null;

    // GovInfo's Search Service is a "public preview" and its response
    // shape is not stable, so we try several plausible snippet fields and
    // fall back to null (Read-more still works, it just links out with
    // no preview). Fields observed in practice: `teaser`, `summary`,
    // `excerpts.excerpts[]`. Everything is optional-chained.
    const excerpts = Array.isArray(r?.excerpts?.excerpts)
      ? r.excerpts.excerpts.filter((s: any) => typeof s === "string").join(" ")
      : null;
    const rawSnippet: string | null = r.teaser ?? r.summary ?? excerpts ?? null;
    const snippet = rawSnippet
      ? String(rawSnippet)
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 260) || null
      : null;

    return {
      title: r.title ?? "Congressional Record entry",
      date: r.dateIssued ?? null,
      section: r.section ?? null,
      url: publicUrl,
      snippet,
    };
  });
}

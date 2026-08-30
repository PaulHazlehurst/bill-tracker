// SERVER-ONLY. Federal Register API wrapper.
//
// Free, no API key required. Publishes every proposed rule, final rule,
// notice, and presidential document from every federal agency. This is
// the source of truth for federal rulemaking - what your commercial
// competitors are wrapping and reselling.
//
// Docs: https://www.federalregister.gov/developers/api/v1
//
// Rate limit: they publish no hard number but the guidance is "be
// reasonable" (~1000 req/hour was the informal ceiling as of the last
// project research pass). This library never fires more than one call
// per topic per discovery run, so we stay well under it.

import { trackedFetch } from "@/lib/apiUsageTracker";

const BASE = "https://www.federalregister.gov/api/v1";

export type FRDocument = {
  documentNumber: string;      // e.g. "2025-12345", stable, use as row id
  title: string;
  abstract: string | null;
  docType: "proposed" | "final" | "notice" | "other";
  docketId: string | null;
  agencies: string[];          // display names
  publicationDate: string;     // YYYY-MM-DD
  commentCloseDate: string | null;
  effectiveDate: string | null;
  htmlUrl: string | null;
  pdfUrl: string | null;
  raw: any;                    // original API response, cached in bulk
};

function normaliseType(raw: string | null | undefined): FRDocument["docType"] {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("proposed")) return "proposed";
  if (s === "rule" || s.includes("final")) return "final";
  if (s === "notice" || s.includes("notice")) return "notice";
  return "other";
}

function mapDocument(r: any): FRDocument | null {
  if (!r?.document_number) return null;
  const agencies: string[] = Array.isArray(r.agencies)
    ? r.agencies.map((a: any) => a?.name).filter((n: any) => typeof n === "string")
    : [];
  return {
    documentNumber: r.document_number,
    title: r.title ?? "(untitled)",
    abstract: r.abstract ?? null,
    docType: normaliseType(r.type),
    docketId: r.docket_id ?? null,
    agencies,
    publicationDate: r.publication_date,
    commentCloseDate: r.comments_close_on ?? null,
    effectiveDate: r.effective_on ?? null,
    htmlUrl: r.html_url ?? null,
    pdfUrl: r.pdf_url ?? null,
    raw: r,
  };
}

// Which FR fields we ask for. Requesting only what we use trims the
// response size significantly.
const FIELDS = [
  "document_number", "title", "abstract", "type", "docket_id",
  "agencies", "publication_date", "comments_close_on", "effective_on",
  "html_url", "pdf_url",
];

// Free-text search over the whole document body. Used by regulation
// discovery: one call per topic per run.
export async function searchRegulations(
  query: string,
  opts: { sinceDaysAgo?: number; perPage?: number } = {}
): Promise<FRDocument[]> {
  const url = new URL(`${BASE}/documents.json`);
  url.searchParams.set("conditions[term]", query);
  url.searchParams.set("per_page", String(opts.perPage ?? 20));
  url.searchParams.set("order", "newest");
  for (const f of FIELDS) url.searchParams.append("fields[]", f);
  if (opts.sinceDaysAgo && opts.sinceDaysAgo > 0) {
    const d = new Date(Date.now() - opts.sinceDaysAgo * 86400_000).toISOString().slice(0, 10);
    url.searchParams.set("conditions[publication_date][gte]", d);
  }

  const res = await trackedFetch(
    url.toString(),
    { next: { revalidate: 900 } } as RequestInit, // 15-minute edge cache
    "federal_register"
  );
  if (!res.ok) throw new Error(`Federal Register search failed: ${res.status}`);
  const body = await res.json();
  const results = (body?.results ?? []) as any[];
  return results.map(mapDocument).filter((d): d is FRDocument => d !== null);
}

// Fetch one document by ID. Not used by discovery (the search response
// already carries every field we need), but included for on-demand refresh
// of a specific regulation from a detail page later.
export async function getRegulation(documentNumber: string): Promise<FRDocument | null> {
  const url = new URL(`${BASE}/documents/${documentNumber}.json`);
  for (const f of FIELDS) url.searchParams.append("fields[]", f);
  const res = await trackedFetch(url.toString(), { cache: "no-store" }, "federal_register");
  if (!res.ok) return null;
  return mapDocument(await res.json());
}

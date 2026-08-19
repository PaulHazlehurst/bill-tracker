// SERVER-ONLY. Client for Rural Care Journey (ruralcarejourney.com) - tracks
// the $50B Rural Health Transformation Program (RHTP) across all 50 states:
// grants, awards, funding opportunities, and state program activity. Run by
// AME Mobile, a rural-health-focused organization - not a government site,
// but the RHTP data itself is aggregated from official state and federal
// sources per their own docs.
//
// Two tiers: /api/stats is genuinely public, no key, confirmed directly
// from their own API reference page. Everything state-specific
// (/api/v1/states/:code, opportunities, awards, documents) requires a paid
// API key (~$99/mo at time of writing) - this app is built to use it the
// moment RURAL_CARE_JOURNEY_API_KEY is set, and degrades gracefully
// without one rather than fabricating numbers.

import { trackedFetch } from "@/lib/apiUsageTracker";

const BASE_URL = "https://www.ruralcarejourney.com/api";

export type RuralHealthStats = {
  states: number;
  documents: number;
  activities: number;
  totalStateAward: number;
  fundingCount: number;
};

export async function getPublicStats(): Promise<RuralHealthStats> {
  const res = await trackedFetch(`${BASE_URL}/stats`, { cache: "no-store" }, "rural_care_journey");
  if (!res.ok) throw new Error(`Rural Care Journey stats fetch failed: ${res.status}`);
  const data = await res.json();
  return {
    states: data.states ?? 0,
    documents: data.documents ?? 0,
    activities: data.activities ?? 0,
    totalStateAward: data.totalStateAward ?? 0,
    fundingCount: data.fundingCount ?? 0,
  };
}

export type StateDetail = {
  code: string;
  name: string;
  cahCount: number | null;
  population: number | null;
  ruralPercent: number | null;
  summary: string | null;
  documents: number;
  awardTotal: number;
  awardeeCount: number;
  recentDocuments: { title: string; fileType: string; category: string; url: string; highlights: string | null }[];
};

export function isConfigured(): boolean {
  return !!process.env.RURAL_CARE_JOURNEY_API_KEY;
}

export async function getStateDetail(code: string): Promise<StateDetail | null> {
  const key = process.env.RURAL_CARE_JOURNEY_API_KEY;
  if (!key) return null; // graceful - no fabricated data, just "not configured"

  const res = await trackedFetch(
    `${BASE_URL}/v1/states/${code}`,
    { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" },
    "rural_care_journey"
  );
  if (!res.ok) throw new Error(`Rural Care Journey state fetch failed: ${res.status}`);
  const data = await res.json();

  return {
    code: data.code ?? code,
    name: data.name ?? code,
    cahCount: data.cahCount ?? null,
    population: data.population ?? null,
    ruralPercent: data.ruralPercent ?? null,
    summary: data.summary ?? null,
    documents: data.documents ?? 0,
    awardTotal: data.awardTotal ?? 0,
    awardeeCount: data.awardeeCount ?? 0,
    recentDocuments: (data.recentDocuments ?? []).slice(0, 5).map((d: any) => ({
      title: d.title ?? "Document",
      fileType: d.fileType ?? "",
      category: d.category ?? "",
      url: d.url ?? "",
      highlights: d.highlights ?? null,
    })),
  };
}

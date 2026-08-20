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

// ── HRSA HPSA data (genuinely free, official, no key) ─────────────
// This is the real goldmine for a rural-health strategies firm:
// every Health Professional Shortage Area in the country, by state,
// with shortage scores, practitioner-need counts, and rural/urban
// classification. Updated daily by HRSA itself.

export type HPSAStateSummary = {
  state: string;
  primaryCareHPSAs: number;
  dentalHPSAs: number;
  mentalHealthHPSAs: number;
  practitionersNeeded: number;
  ruralHPSAs: number;
  nonRuralHPSAs: number;
  totalPopulation: number;
};

// Fetches the HPSA dashboard CSV from HRSA, parses it, and aggregates
// by state. This is a ~5MB CSV with tens of thousands of rows, so it's
// cached aggressively on the server side (revalidate = 86400, once/day,
// which matches HRSA's own stated refresh cycle).
export async function getHPSAByState(): Promise<Record<string, HPSAStateSummary>> {
  const url = "https://data.hrsa.gov/DataDownload/DD_Files/HPSA_DASHBOARD.csv";
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`HRSA HPSA fetch failed: ${res.status}`);
  const text = await res.text();

  const lines = text.split("\n");
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());

  const stateIdx = headers.indexOf("Common State Name");
  const typeIdx = headers.indexOf("HPSA Discipline Class");
  const ruralIdx = headers.indexOf("Rural Status");
  const popIdx = headers.indexOf("HPSA Designation Population");
  const needIdx = headers.indexOf("HPSA Provider Ratio Goal");
  const statusIdx = headers.indexOf("HPSA Status");

  if (stateIdx === -1 || typeIdx === -1) throw new Error("HPSA CSV format changed - column headers not found");

  const byState: Record<string, HPSAStateSummary> = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].match(/(".*?"|[^,]+)/g)?.map((c) => c.replace(/"/g, "").trim());
    if (!cols || cols.length < Math.max(stateIdx, typeIdx, ruralIdx) + 1) continue;

    const status = statusIdx >= 0 ? cols[statusIdx] : "";
    if (status !== "Designated") continue;

    const state = cols[stateIdx];
    if (!state || state.length > 25) continue;

    if (!byState[state]) {
      byState[state] = {
        state,
        primaryCareHPSAs: 0, dentalHPSAs: 0, mentalHealthHPSAs: 0,
        practitionersNeeded: 0, ruralHPSAs: 0, nonRuralHPSAs: 0, totalPopulation: 0,
      };
    }

    const s = byState[state];
    const type = cols[typeIdx];
    if (type === "Primary Care") s.primaryCareHPSAs++;
    else if (type === "Dental Health") s.dentalHPSAs++;
    else if (type === "Mental Health") s.mentalHealthHPSAs++;

    const rural = ruralIdx >= 0 ? cols[ruralIdx] : "";
    if (rural === "Rural") s.ruralHPSAs++;
    else s.nonRuralHPSAs++;

    const pop = popIdx >= 0 ? parseInt(cols[popIdx]) : 0;
    if (!isNaN(pop)) s.totalPopulation += pop;

    const need = needIdx >= 0 ? parseFloat(cols[needIdx]) : 0;
    if (!isNaN(need)) s.practitionersNeeded += Math.ceil(need);
  }

  return byState;
}

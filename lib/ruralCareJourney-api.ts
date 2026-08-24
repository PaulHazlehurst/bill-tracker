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
// Finds a column index by trying exact matches first, then falling back
// to case-insensitive substring matches against a list of candidates -
// defensive against a government CSV's exact header wording not being
// fully knowable in advance from documentation alone.
function findColumn(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const exact = headers.indexOf(c);
    if (exact !== -1) return exact;
  }
  const lower = headers.map((h) => h.toLowerCase());
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

export async function getHPSAByState(): Promise<Record<string, HPSAStateSummary>> {
  const url = "https://data.hrsa.gov/DataDownload/DD_Files/HPSA_DASHBOARD.csv";
  const res = await trackedFetch(url, { next: { revalidate: 86400 } } as RequestInit, "hrsa");
  if (!res.ok) throw new Error(`HRSA HPSA fetch failed: ${res.status}`);
  const text = await res.text();

  const lines = text.split("\n");
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());

  // Confirmed directly against the live file: it starts
  // "Discipline,HHS Region,State,County,HPSA ID,..." - State and
  // Discipline are required; everything else degrades gracefully if its
  // column can't be confidently found rather than failing the whole fetch.
  const stateIdx = findColumn(headers, ["State"]);
  const typeIdx = findColumn(headers, ["Discipline"]);
  const ruralIdx = findColumn(headers, ["Rural Status", "Rural"]);
  const popIdx = findColumn(headers, ["Designation Population", "HPSA Population", "Population"]);
  const needIdx = findColumn(headers, ["Provider Ratio Goal", "Providers Needed", "Practitioners Needed"]);
  const statusIdx = findColumn(headers, ["HPSA Status", "Status"]);

  if (stateIdx === -1 || typeIdx === -1) {
    throw new Error(`HPSA CSV columns not found. Headers seen: ${headers.slice(0, 15).join(" | ")}`);
  }

  const byState: Record<string, HPSAStateSummary> = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].match(/(".*?"|[^,]+)/g)?.map((c) => c.replace(/"/g, "").trim());
    if (!cols || cols.length <= Math.max(stateIdx, typeIdx)) continue;

    // Only filter by status if that column was confidently found AND its
    // values look like the expected vocabulary - an uncertain filter that
    // silently zeroes out every row is worse than not filtering at all.
    if (statusIdx !== -1) {
      const status = cols[statusIdx] ?? "";
      if (status && status !== "Designated" && status !== "Proposed For Withdrawal") continue;
    }

    const state = cols[stateIdx];
    if (!state || state.length > 30 || /^\d/.test(state)) continue;

    if (!byState[state]) {
      byState[state] = {
        state,
        primaryCareHPSAs: 0, dentalHPSAs: 0, mentalHealthHPSAs: 0,
        practitionersNeeded: 0, ruralHPSAs: 0, nonRuralHPSAs: 0, totalPopulation: 0,
      };
    }

    const s = byState[state];
    const type = (cols[typeIdx] ?? "").toLowerCase();
    if (type.includes("primary")) s.primaryCareHPSAs++;
    else if (type.includes("dental")) s.dentalHPSAs++;
    else if (type.includes("mental")) s.mentalHealthHPSAs++;

    if (ruralIdx !== -1) {
      const rural = (cols[ruralIdx] ?? "").toLowerCase();
      if (rural.includes("rural") && !rural.includes("non")) s.ruralHPSAs++;
      else if (rural) s.nonRuralHPSAs++;
    }

    if (popIdx !== -1) {
      const pop = parseInt((cols[popIdx] ?? "").replace(/[^0-9]/g, ""));
      if (!isNaN(pop)) s.totalPopulation += pop;
    }

    if (needIdx !== -1) {
      const need = parseFloat((cols[needIdx] ?? "").replace(/[^0-9.]/g, ""));
      if (!isNaN(need)) s.practitionersNeeded += Math.ceil(need);
    }
  }

  return byState;
}

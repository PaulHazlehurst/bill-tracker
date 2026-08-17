// SERVER-ONLY. Client for LDA.gov, the official successor to the old
// lda.senate.gov lobbying disclosure API (which is being retired mid-2026).
// Run jointly by the House Legislative Resource Center and Senate Office
// of Public Records - a legal disclosure requirement, not a service that
// can just shut down like OpenSecrets did.
//
// filing_specific_lobbying_issues is confirmed correct against LDA.gov's
// own published API docs - the earlier uncertainty about this (three
// candidate parameters all appearing to return identical unfiltered
// results when tested directly) turned out to be an artifact of the
// testing environment, not a wrong guess.
//
// One real bug that same documentation caught: LDA's search syntax treats
// space-separated words as OR'd terms unless wrapped in quotes - so a bare
// "H.R. 18" was searching for "H.R." OR "18", not the exact citation. Now
// sent as a quoted phrase.

import { trackedFetch } from "@/lib/apiUsageTracker";

const BASE_URL = "https://lda.gov/api/v1";

function headers(): Record<string, string> {
  const key = process.env.LDA_API_KEY;
  return key ? { Authorization: `ApiKey ${key}` } : {};
}

export type LobbyingFiling = {
  filingUuid: string;
  filingYear: number;
  filingType: string;
  registrantName: string;
  clientName: string;
  issueDescription: string;
  documentUrl: string;
};

// Searches for lobbying filings whose "specific issue" text mentions this
// bill. Only called on-demand (bill detail page), never as part of the
// batch poller.
//
// `congress` matters more than it might look: bill NUMBERS reset every
// Congress, so "H.R. 1234" in the 119th Congress and "H.R. 1234" in the
// 115th Congress are completely different bills. filing_year is a real,
// confirmed filter field, so each of the two calendar years a Congress
// spans gets its own scoped request - more reliable than fetching broadly
// and filtering client-side, since a popular citation could otherwise have
// its current-Congress matches crowded out of a single page by older,
// unrelated ones sharing the same bill number.
export async function searchFilingsForBill(billCitation: string, congress: number): Promise<LobbyingFiling[]> {
  const congressStartYear = 1789 + (congress - 1) * 2; // 1st Congress began 1789, each spans 2 years
  const validYears = [congressStartYear, congressStartYear + 1];

  // Word-boundary check as a second, precise filter on top of LDA's own
  // phrase search - guards against "H.R. 1234" matching inside "H.R. 12345".
  const escaped = billCitation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const citationPattern = new RegExp(`\\b${escaped}\\b(?!\\d)`, "i");

  const results: LobbyingFiling[] = [];

  for (const year of validYears) {
    const url = new URL(`${BASE_URL}/filings/`);
    url.searchParams.set("filing_specific_lobbying_issues", `"${billCitation}"`); // quoted = exact phrase, not OR'd words
    url.searchParams.set("filing_year", String(year));
    url.searchParams.set("ordering", "-dt_posted");
    url.searchParams.set("page_size", "25");

    const res = await trackedFetch(url.toString(), { headers: headers(), cache: "no-store" }, "lda_gov");
    if (!res.ok) {
      console.error(`LDA.gov filings fetch failed for year ${year}: ${res.status}`);
      continue;
    }
    const data = await res.json();

    for (const filing of data.results ?? []) {
      for (const activity of filing.lobbying_activities ?? []) {
        const desc: string = activity.description ?? "";
        if (citationPattern.test(desc)) {
          results.push({
            filingUuid: filing.filing_uuid,
            filingYear: filing.filing_year,
            filingType: filing.filing_type_display,
            registrantName: filing.registrant?.name ?? "Unknown",
            clientName: filing.client?.name ?? "Unknown",
            issueDescription: desc,
            documentUrl: filing.filing_document_url,
          });
          break; // one match per filing is enough to surface it
        }
      }
    }
  }

  return results.slice(0, 15);
}

// Builds the citation text to search for, e.g. "H.R. 1234" - matches how
// these are typically written in LDA filings' free-text issue descriptions.
export function billCitationForLda(billType: string, billNumber: number | string): string {
  const typeMap: Record<string, string> = {
    hr: "H.R.", s: "S.", hjres: "H.J.Res.", sjres: "S.J.Res.",
    hconres: "H.Con.Res.", sconres: "S.Con.Res.", hres: "H.Res.", sres: "S.Res.",
  };
  const prefix = typeMap[billType.toLowerCase()] ?? billType.toUpperCase();
  return `${prefix} ${billNumber}`;
}

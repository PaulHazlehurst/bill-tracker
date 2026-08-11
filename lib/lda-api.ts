// SERVER-ONLY. Client for LDA.gov, the official successor to the old
// lda.senate.gov lobbying disclosure API (which is being retired mid-2026).
// Run jointly by the House Legislative Resource Center and Senate Office
// of Public Records - a legal disclosure requirement, not a service that
// can just shut down like OpenSecrets did.
//
// HONESTY NOTE on the search parameter below: I could not empirically
// confirm the exact query parameter name for searching filings by issue
// text - three candidates I tested against the live API all returned
// identical unfiltered results, which is ambiguous (could mean the guess
// is wrong, or could mean an intermediate cache was ignoring my query
// strings entirely - the API's own response metadata suggested the latter).
// Multiple independent third-party tools built against this exact API do
// describe this filter as real and working. Went with the best-supported
// guess; see the safety check in searchFilingsForBill below - if the
// result count suggests the filter didn't apply, this bails out rather
// than processing/paginating through anything close to the full ~2 million
// record dataset. If this comes back empty in production even for bills
// you know have lobbying activity, that's the first thing to revisit -
// email lobbyinfo@mail.house.gov or lobby@sec.senate.gov to get the exact
// parameter name and I'll fix it precisely rather than guess again.

const BASE_URL = "https://lda.gov/api/v1";

// A response with a count anywhere near the full dataset size means our
// filter almost certainly didn't apply - safer to report "no confident
// match" than to trust or process a near-unfiltered result.
const UNFILTERED_COUNT_THRESHOLD = 5000;

function headers() {
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
export async function searchFilingsForBill(billCitation: string): Promise<LobbyingFiling[]> {
  const url = new URL(`${BASE_URL}/filings/`);
  url.searchParams.set("filing_specific_lobbying_issues", billCitation);
  url.searchParams.set("page_size", "25");

  const res = await fetch(url.toString(), { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`LDA.gov filings fetch failed: ${res.status}`);
  const data = await res.json();

  if (typeof data.count === "number" && data.count > UNFILTERED_COUNT_THRESHOLD) {
    console.warn(`LDA.gov search for "${billCitation}" returned ${data.count} results - likely unfiltered, not the actual match count. Skipping.`);
    return [];
  }

  const results: LobbyingFiling[] = [];
  for (const filing of data.results ?? []) {
    for (const activity of filing.lobbying_activities ?? []) {
      const desc: string = activity.description ?? "";
      if (desc.toLowerCase().includes(billCitation.toLowerCase())) {
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

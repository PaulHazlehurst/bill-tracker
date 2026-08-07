// Shared between BillCard and the bill detail page, so both read the
// congress.gov snapshot the same way instead of duplicating this parsing.

export function formatDate(d: string | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

export function timeAgo(d: string | null | undefined) {
  if (!d) return null;
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export const STAGE_LABELS: Record<string, string> = {
  introduced: "Introduced",
  committee: "In committee",
  passed_house: "Passed House",
  passed_senate: "Passed Senate",
  to_president: "Sent to President",
  enacted: "Enacted",
  vetoed: "Vetoed",
  failed: "Failed",
};

// Pulls the extra descriptive fields (sponsor, chamber, policy area,
// cosponsor count) out of the raw congress.gov snapshot we already store -
// no extra API calls needed, this data was fetched once when the bill was
// first tracked.
export function extractMeta(raw: any) {
  if (!raw) return null;
  const sponsor = raw.sponsors?.[0];
  return {
    chamber: raw.originChamber ?? null,
    introducedDate: formatDate(raw.introducedDate),
    policyArea: raw.policyArea?.name ?? null,
    sponsorName: sponsor?.fullName ?? (sponsor ? `${sponsor.firstName ?? ""} ${sponsor.lastName ?? ""}`.trim() : null),
    sponsorParty: sponsor?.party ?? null,
    sponsorState: sponsor?.state ?? null,
    cosponsorCount: raw.cosponsors?.count ?? null,
    committeeCount: raw.committees?.count ?? null,
    summary: raw.summary?.text ?? null,
  };
}

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

export const EVENT_TYPE_ICONS: Record<string, string> = {
  status_change: "trending-up",
  new_action: "file-text",
  cosponsor_change: "users",
};

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

// congress.gov embeds vote tallies directly in an action's text, e.g.
// "Passed Senate without amendment by Yea-Nay Vote. 79 - 19. Record Vote
// Number: 71." - so we can extract real vote results from text we already
// store, with no extra API call. Returns null if the text doesn't describe
// a recorded vote.
export type VoteInfo = { yea: number; nay: number; rollNumber: string | null; passed: boolean };

export function parseVoteInfo(text: string | null | undefined): VoteInfo | null {
  if (!text) return null;
  const tally = text.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!tally) return null;
  // Only treat this as a vote if the surrounding text actually mentions one -
  // otherwise something like a bare "H.R. 1234" could false-positive.
  if (!/vote/i.test(text)) return null;

  const yea = parseInt(tally[1], 10);
  const nay = parseInt(tally[2], 10);
  const rollMatch = text.match(/(?:Record Vote|Roll(?:call)? Vote|Vote) Number:?\s*(\d+)/i);

  return {
    yea,
    nay,
    rollNumber: rollMatch ? rollMatch[1] : null,
    passed: /passed|agreed to|adopted/i.test(text),
  };
}

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
    // CBO is required by law to cost nearly every bill a committee reports
    // out - confirmed directly from congress.gov's own API docs that this
    // rides along on the same bill response already being fetched and
    // cached, so displaying it costs nothing extra.
    cboCostEstimates: (raw.cboCostEstimates?.item ?? []).map((c: any) => ({
      title: c.title ?? null,
      description: c.description ?? null,
      url: c.url ?? null,
      date: c.pubDate ?? null,
    })),
  };
}

// Deterministic "initials avatar" for entities we only have a name for
// (lobbying clients/registrants) - no real logo API can reliably match a
// company name to the right domain, so a wrong guessed logo would be worse
// than an honest colored initial. The color is hashed from the name itself,
// so the same company always gets the same color across the app - a real
// (if small) form of visual recognition, "I've seen that blue square with
// a P before."
const AVATAR_COLORS = [
  "#2c5f9e", "#15803d", "#a16207", "#b8342a", "#6d28d9", "#0e7490", "#be185d", "#4d7c0f",
];

export function avatarColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// A real favicon, honestly sourced - unlike the lobbyist case above, news
// articles come with a real URL, so the domain (and therefore the favicon)
// is genuinely correct, not a guess. Google's public favicon service needs
// no key and no signup.
export function faviconFor(articleUrl: string): string | null {
  try {
    const domain = new URL(articleUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch {
    return null;
  }
}

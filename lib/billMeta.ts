// Shared between BillCard and the bill detail page, so both read the
// congress.gov snapshot the same way instead of duplicating this parsing.

// congress.gov gives many dates as a bare day ("2026-10-14"). JavaScript
// reads those as midnight UTC, which is the previous evening anywhere in the
// US - so every such date used to display one day early. Bare days are now
// read as local calendar dates.
export function parseDay(d: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date(d);
}

export function formatDate(d: string | null | undefined) {
  if (!d) return null;
  const date = parseDay(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
  text_published: "scroll",
  cbo_published: "calculator",
  summary_published: "book",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  status_change: "Moved forward",
  new_action: "New action",
  cosponsor_change: "Cosponsors",
  text_published: "New text",
  cbo_published: "CBO estimate",
  summary_published: "CRS summary",
};

// Stage labels/order live in lib/billStage.ts; re-exported here so existing
// imports keep working.
export { STAGE_LABELS, STAGE_ORDER, STAGE_SHORT } from "@/lib/billStage";

const CITATION_PREFIX: Record<string, string> = {
  hr: "H.R.", s: "S.", hjres: "H.J.Res.", sjres: "S.J.Res.", hconres: "H.Con.Res.", sconres: "S.Con.Res.", hres: "H.Res.", sres: "S.Res.",
};

/** "hr-1234-119" -> "H.R. 1234". Also accepts (type, number). */
export function citationFor(billIdOrType: string, number?: string | number): string {
  if (number !== undefined) return `${CITATION_PREFIX[billIdOrType.toLowerCase()] ?? billIdOrType.toUpperCase()} ${number}`;
  const [type, num] = billIdOrType.split("-");
  return `${CITATION_PREFIX[type] ?? (type ?? "").toUpperCase()} ${num ?? ""}`.trim();
}

/** Public congress.gov page for a bill id like "hr-1234-119". */
export function publicBillUrl(billId: string): string {
  const [type, num, cong] = billId.split("-");
  const slug: Record<string, string> = {
    hr: "house-bill", s: "senate-bill", hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
    hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution", hres: "house-resolution", sres: "senate-resolution",
  };
  const n = Number(cong);
  const ord = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `https://www.congress.gov/bill/${n}${ord}-congress/${slug[type] ?? "house-bill"}/${num}`;
}

// ── Plain-English action explainer ───────────────────────────────────
// Congressional action text is written for clerks ("Placed on the Union
// Calendar, Calendar No. 412."). This maps the common procedural phrases to
// one plain sentence about what happened and what it means. Rule-based on
// purpose - deterministic, the same answer for the same text, no AI.
// Returns null for anything it doesn't recognise, so nothing is guessed.
const EXPLAINERS: [RegExp, string][] = [
  [/became (public|private) law/i, "It's law. The bill has been signed and assigned a public law number."],
  [/signed by (the )?president/i, "The President signed it, so it becomes law."],
  [/vetoed by (the )?president|pocket veto/i, "The President rejected it. Congress can override a veto with a two-thirds vote in both chambers."],
  [/presented to (the )?president/i, "Sent to the President, who has 10 days (Sundays excepted) to sign or veto it."],
  [/cloture/i, "A Senate vote to end debate. It needs 60 votes and is often the real hurdle before final passage."],
  [/resolving differences|conference (report|committee)|agree to the (house|senate) amendment/i, "The House and Senate are reconciling the differences between their versions of the bill."],
  [/motion to suspend the rules/i, "A fast-track House vote: limited debate, no amendments, and two-thirds needed to pass. Usually used for less controversial bills."],
  [/passed\/agreed to in house|^passed house|on passage passed/i, "The full House voted to approve the bill."],
  [/passed\/agreed to in senate|^passed senate/i, "The full Senate voted to approve the bill."],
  [/failed of passage|not agreed to/i, "The vote failed, so the bill did not pass at this step."],
  [/unanimous consent/i, "Approved without objection, so there was no recorded vote."],
  [/motion to reconsider laid on the table/i, "Routine procedure that makes the previous vote final."],
  [/received in the senate/i, "The bill arrived in the Senate after passing the House. It now starts the Senate process, usually in committee."],
  [/received in the house|held at the desk/i, "The bill is being held for possible floor action instead of going to committee, which can speed things up."],
  [/message on (house|senate) action sent/i, "One chamber formally notified the other of its action."],
  [/rules committee resolution|rule h\. ?res|providing for consideration/i, "The House Rules Committee set the terms for debate. This usually means a floor vote is coming soon."],
  [/placed on (the )?union calendar/i, "Now eligible for a House floor vote. (The Union Calendar is for bills that spend or raise money.) House leadership decides when, or whether, it comes up."],
  [/placed on (the )?house calendar/i, "Now eligible for a House floor vote. House leadership decides when, or whether, it comes up."],
  [/placed on senate legislative calendar/i, "Now eligible for Senate floor consideration. Senate leadership decides when it comes up."],
  [/ordered to be reported/i, "The committee voted to advance the bill to the full chamber. A meaningful step: most bills never get a committee vote."],
  [/reported by|reported \((amended|without amendment|with an amendment)\)|reported (to|in) (the )?(house|senate)|reported with(out)? amendment|committee report/i, "The committee formally sent the bill to the full chamber, usually with a written report explaining it."],
  [/mark-?up/i, "The committee debated and amended the bill line by line."],
  [/hearings? held|hearings? by/i, "The committee held a hearing where witnesses testified about the issue."],
  [/discharged/i, "The bill was pulled out of committee without a committee vote."],
  [/referred to (the )?subcommittee/i, "Passed to a subcommittee for closer review."],
  [/referred to/i, "Sent to committee for review. This is where most bills stop: committees choose which few to act on."],
  [/introduced in/i, "The bill was formally filed in Congress."],
  [/sponsor introductory remarks/i, "The sponsor spoke about the bill on the floor."],
  [/star print/i, "A corrected reprint of the bill text was ordered."],
];

export function explainAction(text: string | null | undefined, billType?: string): string | null {
  if (!text) return null;
  for (const [rx, plain] of EXPLAINERS) {
    if (!rx.test(text)) continue;
    // Passage means different things depending on which chamber the bill
    // started in, so say what comes next only when we know.
    if (billType && !/res$/i.test(billType)) {
      const senateBill = billType.toLowerCase().startsWith("s");
      const house = /passed\/agreed to in house|^passed house|on passage passed/i.test(text);
      const senate = /passed\/agreed to in senate|^passed senate/i.test(text);
      if (house) return `${plain} ${senateBill ? "With the Senate already on board, the next step is the President (once both chambers agree on the same text)." : "Next it needs to pass the Senate."}`;
      if (senate) return `${plain} ${senateBill ? "Next it needs to pass the House." : "With the House already on board, the next step is the President (once both chambers agree on the same text)."}`;
    }
    return plain;
  }
  return null;
}

/** Whole days since a date, or null. */
export function daysSince(d: string | null | undefined): number | null {
  if (!d) return null;
  const date = parseDay(d);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return Math.max(0, Math.round((today.getTime() - date.getTime()) / 86_400_000));
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

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
  // Only treat this as a vote if the surrounding text actually describes
  // one - "Record Vote", "Yea-Nay Vote", House style "the Yeas and Nays ...
  // (Roll no. 288)" - otherwise something like "H.R. 1234" could match.
  if (!/vote|yeas and nays|roll no\.?|yea-nay/i.test(text)) return null;

  const yea = parseInt(tally[1], 10);
  const nay = parseInt(tally[2], 10);
  const rollMatch = text.match(/(?:Record Vote|Roll(?:call)? Vote|Vote) Number:?\s*(\d+)/i) ?? text.match(/Roll no\.?\s*(\d+)/i);

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
    // congress.gov's JSON returns this as a plain array (its XML wraps it
    // in <item>); handle both so the CBO section actually shows up.
    cboCostEstimates: (Array.isArray(raw.cboCostEstimates) ? raw.cboCostEstimates : raw.cboCostEstimates?.item ?? []).map((c: any) => ({
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

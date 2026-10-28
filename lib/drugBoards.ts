// State prescription drug affordability boards: shared pieces used by the
// page, the morning job and the tests. Pure (no I/O).

import { decodeEntities } from "@/lib/houseFloor";

// ── Drug review stages ────────────────────────────────────────────────

export const DRUG_STAGES = [
  "identified",
  "selected",
  "under_review",
  "unaffordable",
  "limit_proposed",
  "limit_set",
  "limit_blocked",
  "recommendation",
  "closed",
] as const;
export type DrugStage = (typeof DRUG_STAGES)[number];

export const DRUG_STAGE_LABELS: Record<DrugStage, string> = {
  identified: "Identified",
  selected: "Selected for review",
  under_review: "Under review",
  unaffordable: "Found unaffordable",
  limit_proposed: "Limit proposed",
  limit_set: "Limit set",
  limit_blocked: "Blocked in court",
  recommendation: "Recommendation sent",
  closed: "Closed",
};

/** Same color language as bills: amber = in review, blue = proposed, mint = done, red = stopped. */
export function drugStageTone(stage: string): "idle" | "committee" | "chamber" | "law" | "stopped" | "president" {
  switch (stage) {
    case "selected":
    case "under_review":
      return "committee";
    case "unaffordable":
      return "president";
    case "limit_proposed":
    case "recommendation":
      return "chamber";
    case "limit_set":
      return "law";
    case "limit_blocked":
      return "stopped";
    default:
      return "idle";
  }
}

/** Stations on the drug's track, and how far along it is (0-based). */
export const DRUG_TRACK = ["Selected", "Review", "Unaffordable", "Proposed", "Limit"];
export function drugTrackPosition(stage: string): { reached: number; stopped: boolean; finished: boolean } {
  const map: Record<string, number> = { identified: 0, selected: 0, under_review: 1, unaffordable: 2, recommendation: 2, limit_proposed: 3, limit_set: 4, limit_blocked: 4, closed: 1 };
  return { reached: map[stage] ?? 0, stopped: stage === "limit_blocked", finished: stage === "limit_set" };
}

// ── A US tile map (one square per state, roughly in place) ────────────

export const STATE_TILES: [string, number, number][] = [
  ["AK", 0, 0], ["ME", 11, 0],
  ["VT", 10, 1], ["NH", 11, 1],
  ["WA", 1, 2], ["ID", 2, 2], ["MT", 3, 2], ["ND", 4, 2], ["MN", 5, 2], ["IL", 6, 2], ["WI", 7, 2], ["MI", 8, 2], ["NY", 9, 2], ["RI", 10, 2], ["MA", 11, 2],
  ["OR", 1, 3], ["NV", 2, 3], ["WY", 3, 3], ["SD", 4, 3], ["IA", 5, 3], ["IN", 6, 3], ["OH", 7, 3], ["PA", 8, 3], ["NJ", 9, 3], ["CT", 10, 3],
  ["CA", 1, 4], ["UT", 2, 4], ["CO", 3, 4], ["NE", 4, 4], ["MO", 5, 4], ["KY", 6, 4], ["WV", 7, 4], ["VA", 8, 4], ["MD", 9, 4], ["DE", 10, 4],
  ["AZ", 2, 5], ["NM", 3, 5], ["KS", 4, 5], ["AR", 5, 5], ["TN", 6, 5], ["NC", 7, 5], ["SC", 8, 5], ["DC", 9, 5],
  ["OK", 4, 6], ["LA", 5, 6], ["MS", 6, 6], ["AL", 7, 6], ["GA", 8, 6],
  ["HI", 0, 7], ["TX", 4, 7], ["FL", 9, 7],
];

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// ── Finding documents on a board's web page ───────────────────────────

const FILE_EXT = /\.(pdf|docx?|pptx?|xlsx?)(?:$|[?#])/i;
const DOC_WORDS = /\b(agenda|minutes|materials?|packet|package|transcript|slides|presentation|notice|hearing|public comment|cost review|affordability review|upper payment limit|report|recording)\b/i;

export type FoundDocument = { url: string; title: string };

function cleanText(s: string) {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function fileName(url: string) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return last.replace(FILE_EXT, "").replace(/[_+]+/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    return url;
  }
}

/**
 * Links on a board page that point at documents: any PDF, Word, PowerPoint
 * or Excel file, plus same-site links whose text says agenda, minutes,
 * report and so on. Each comes back once, with an absolute address.
 */
export function extractDocuments(html: string, pageUrl: string): FoundDocument[] {
  const out: FoundDocument[] = [];
  const seen = new Set<string>();
  const page = new URL(pageUrl);
  const rx = /<a\b([^>]*?)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html))) {
    const rawHref = decodeEntities((m[2] ?? m[3] ?? m[4] ?? "").trim());
    if (!rawHref || /^(mailto:|tel:|javascript:|#)/i.test(rawHref)) continue;
    let url: URL;
    try {
      url = new URL(rawHref, page);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    url.hash = "";
    const href = url.toString();
    const attrs = `${m[1]} ${m[5]}`;
    const label = cleanText(m[6]) || cleanText(attrs.match(/(?:title|aria-label)\s*=\s*"([^"]*)"/i)?.[1] ?? "");
    const isFile = FILE_EXT.test(href);
    const looksLikeDoc = url.host === page.host && DOC_WORDS.test(label) && label.length >= 6;
    if (!isFile && !looksLikeDoc) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const title = label && !/^(download|view|pdf|here|click here|link)$/i.test(label) ? label : fileName(href);
    out.push({ url: href, title: title.slice(0, 300) });
  }
  return out;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2015 || y > 2040) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** The date a document is about, read from its title or address ("2026.3.23 Board Meeting Agenda", "20261021-PDAB...", "May 18, 2026"). */
export function parseDocDate(text: string): string | null {
  let s = text;
  try {
    s = decodeURIComponent(text);
  } catch {
    // keep as is
  }
  let m = s.match(/(?<!\d)(20\d{2})[-._/](\d{1,2})[-._/](\d{1,2})(?!\d)/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m) {
    const r = iso(+m[1], +m[2], +m[3]);
    if (r) return r;
  }
  m = s.match(/(?<!\d)(\d{1,2})[-._/](\d{1,2})[-._/](20\d{2}|\d{2})(?!\d)/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const r = iso(y, +m[1], +m[2]);
    if (r) return r;
  }
  m = s.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?[\s._-]+(\d{1,2})(?:st|nd|rd|th)?[,\s._-]+(20\d{2})\b/i);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m![1].toLowerCase().slice(0, 3))) + 1;
    return iso(+m[3], month, +m[2]);
  }
  return null;
}

export function docKind(text: string): string {
  const t = text.toLowerCase();
  if (/agenda/.test(t)) return "agenda";
  if (/minutes/.test(t)) return "minutes";
  if (/transcript/.test(t)) return "transcript";
  if (/slides|presentation|materials?|packet|package/.test(t)) return "materials";
  if (/notice|hearing|rulemaking|proposed rule/.test(t)) return "notice";
  if (/comment/.test(t)) return "comment";
  if (/report|study|review|analysis/.test(t)) return "report";
  return "other";
}

export const DOC_KIND_LABELS: Record<string, string> = {
  agenda: "Agenda",
  minutes: "Minutes",
  transcript: "Transcript",
  materials: "Meeting materials",
  notice: "Notice",
  comment: "Public comment",
  report: "Report",
  other: "Document",
};

// ── State bills from Open States ──────────────────────────────────────

export type StateBill = {
  id: string;
  state: string;
  session: string | null;
  identifier: string;
  title: string;
  latest_action: string | null;
  latest_action_date: string | null;
  url: string | null;
};

/** One Open States bill record -> our row. Null if it isn't a state bill. */
export function normalizeOpenStatesBill(raw: any): StateBill | null {
  if (!raw?.id || !raw.identifier || !raw.title) return null;
  const jid = String(raw.jurisdiction?.id ?? "");
  const state = jid.match(/\/state:([a-z]{2})\//i)?.[1] ?? (jid.includes("district:dc") ? "dc" : null);
  if (!state) return null;
  return {
    id: String(raw.id),
    state: state.toUpperCase(),
    session: raw.session ? String(raw.session) : null,
    identifier: String(raw.identifier),
    title: String(raw.title).replace(/\s+/g, " ").trim(),
    latest_action: raw.latest_action_description ?? null,
    latest_action_date: raw.latest_action_date ? String(raw.latest_action_date).slice(0, 10) : null,
    url: raw.openstates_url ?? null,
  };
}

/** Bills that are about drug affordability boards, not just mentioning drugs. */
export function isAboutDrugBoards(title: string): boolean {
  return /drug affordability|prescription drug.{0,40}(board|council|review)|upper payment limit|affordability review board/i.test(title);
}

// ── Drug tracker edits ────────────────────────────────────────────────

export const DRUG_FIELDS = ["state", "drug", "manufacturer", "stage", "price_limit", "limit_basis", "next_step", "next_date", "source_url", "notes", "needs_check"] as const;
export type DrugFields = Partial<Record<(typeof DRUG_FIELDS)[number], string | boolean | null>>;

const FIELD_LABELS: Record<string, string> = {
  state: "State",
  drug: "Drug",
  manufacturer: "Manufacturer",
  stage: "Stage",
  price_limit: "Price limit",
  limit_basis: "Basis",
  next_step: "Next step",
  next_date: "Next date",
  source_url: "Source",
  notes: "Notes",
};

/** Cleans what the page sent: known fields only, trimmed, empty strings become null. */
export function cleanDrugInput(body: Record<string, unknown>): { fields: DrugFields; error?: string } {
  const fields: DrugFields = {};
  for (const f of DRUG_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (f === "needs_check") fields[f] = !!v;
    else if (v === null || v === undefined || (typeof v === "string" && !v.trim())) fields[f] = null;
    else fields[f] = String(v).trim().slice(0, f === "notes" ? 2000 : 300);
  }
  if ("stage" in fields && !DRUG_STAGES.includes(fields.stage as DrugStage)) return { fields, error: "Unknown stage." };
  if ("next_date" in fields && fields.next_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(fields.next_date))) return { fields, error: "Dates look like 2026-11-16." };
  if ("source_url" in fields && fields.source_url && !/^https?:\/\//i.test(String(fields.source_url))) return { fields, error: "The source should be a web address starting with http." };
  if ("state" in fields && fields.state) fields.state = String(fields.state).toUpperCase();
  if ("drug" in fields && !fields.drug) return { fields, error: "Name the drug." };
  return { fields };
}

/** One line per meaningful change, for the drug's history. */
export function describeDrugChanges(before: Record<string, any>, after: DrugFields): string[] {
  const out: string[] = [];
  for (const [f, v] of Object.entries(after)) {
    const old = before[f] ?? null;
    if (old === v || (old == null && v == null)) continue;
    if (f === "needs_check") {
      out.push(v ? "Marked as needing a check" : "Checked against the source");
      continue;
    }
    const label = FIELD_LABELS[f] ?? f;
    const show = (x: any) => (x == null || x === "" ? "blank" : f === "stage" ? DRUG_STAGE_LABELS[x as DrugStage] ?? x : String(x));
    if (f === "notes") out.push(old ? "Notes edited" : "Notes added");
    else out.push(`${label}: ${show(old)} → ${show(v)}`);
  }
  return out;
}

/**
 * Only public https websites can be watched. Anyone signed in can add a
 * page, and the server fetches it, so internal or private addresses are
 * refused (no IP addresses, localhost, or internal-only names).
 */
export function isPublicWebUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return false;
  if (/^[\d.]+$/.test(host) || host.startsWith("[") || host.includes(":")) return false;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host)) return false;
  return true;
}

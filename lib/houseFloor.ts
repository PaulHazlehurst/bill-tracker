// The House floor schedule: the Majority Leader's weekly "Bills This Week"
// list, published at docs.house.gov/floor as one XML file per week.
//
// It says which bills may come up that week and how (under suspension of
// the rules, which needs two-thirds, or under a rule), but not which day.
// The Senate publishes nothing equivalent in a machine-readable form, so
// Week ahead shows the House floor only and says so.
//
// The parser is deliberately forgiving: the House doesn't publish a schema
// for this file, so it reads the elements it knows (category, floor-item,
// legis-num, floor-text) and, if those ever change, falls back to picking
// bill numbers out of the text rather than showing nothing.

import { billIdFromCitation } from "@/lib/billMeta";

export type FloorCategory = "suspension" | "rule" | "other";

export type FloorItem = {
  citation: string;
  billId: string | null;
  title: string;
  category: FloorCategory;
};

export const FLOOR_CATEGORY_LABELS: Record<FloorCategory, string> = {
  suspension: "Under suspension of the rules (needs two-thirds)",
  rule: "Under a rule",
  other: "May be considered",
};

/** The Monday (in Washington time) of the week containing `d`, as YYYY-MM-DD. */
export function weekMonday(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const local = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
  const dow = local.getUTCDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  local.setUTCDate(local.getUTCDate() - back);
  return local.toISOString().slice(0, 10);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function floorScheduleUrl(monday: string): string {
  const compact = monday.replace(/-/g, "");
  return `https://docs.house.gov/floor/Download.aspx?file=/billsthisweek/${compact}/${compact}.xml`;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function textOf(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function categoryFrom(attrs: string, body: string): FloorCategory {
  // Only the category's own label counts, never a bill title inside it (a
  // title like "disapproval of the rule submitted by..." isn't a category).
  const firstItem = body.search(/<floor-item\b|<legis-num\b/i);
  const heading = firstItem >= 0 ? body.slice(0, firstItem) : body.slice(0, 300);
  const hint = `${attrs} ${heading}`.toLowerCase();
  if (hint.includes("suspension")) return "suspension";
  if (/pursuant to a rule|\brule\b/.test(hint)) return "rule";
  return "other";
}

const CITATION_RX = /\b(H\.\s?R\.|S\.|H\.\s?J\.\s?Res\.|S\.\s?J\.\s?Res\.|H\.\s?Con\.\s?Res\.|S\.\s?Con\.\s?Res\.|H\.\s?Res\.|S\.\s?Res\.)\s?(\d{1,5})\b/g;

/** Reads the weekly XML. Items marked as removed from the schedule are left out. */
export function parseFloorXml(xml: string, congress: number): FloorItem[] {
  const items: FloorItem[] = [];
  const seen = new Set<string>();
  const add = (citationRaw: string, title: string, category: FloorCategory) => {
    const citation = citationRaw.replace(/\s+/g, " ").trim();
    const billId = billIdFromCitation(citation, congress);
    const key = billId ?? citation.toLowerCase();
    if (!citation || seen.has(key)) return;
    seen.add(key);
    items.push({ citation, billId, title: title.replace(/\s+/g, " ").trim(), category });
  };

  const categoryBlocks = Array.from(xml.matchAll(/<category\b([^>]*)>([\s\S]*?)<\/category>/gi));
  const blocks = categoryBlocks.length ? categoryBlocks.map((m) => ({ attrs: m[1], body: m[2] })) : [{ attrs: "", body: xml }];

  for (const block of blocks) {
    const category = categoryFrom(block.attrs, block.body);
    const floorItems = Array.from(block.body.matchAll(/<floor-item\b([^>]*)>([\s\S]*?)<\/floor-item>/gi));
    if (floorItems.length) {
      for (const fi of floorItems) {
        const removed = /remove-date\s*=\s*"[^"\s]+"/i.test(fi[1]);
        if (removed) continue;
        const num = fi[2].match(/<legis-num\b[^>]*>([\s\S]*?)<\/legis-num>/i);
        const text = fi[2].match(/<floor-text\b[^>]*>([\s\S]*?)<\/floor-text>/i);
        if (num) add(textOf(num[1]), text ? textOf(text[1]) : "", category);
      }
      continue;
    }
    const nums = Array.from(block.body.matchAll(/<legis-num\b[^>]*>([\s\S]*?)<\/legis-num>/gi));
    if (nums.length) {
      for (const n of nums) add(textOf(n[1]), "", category);
      continue;
    }
    // Last resort: any bill numbers in the text.
    for (const m of textOf(block.body).matchAll(CITATION_RX)) add(`${m[1]} ${m[2]}`, "", category);
  }
  return items;
}

/** Downloads and parses one week. Returns null when the House hasn't posted that week. */
export async function fetchFloorWeek(monday: string, congress: number): Promise<{ items: FloorItem[]; url: string } | null> {
  const url = floorScheduleUrl(monday);
  const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/xml,text/xml" } });
  if (!res.ok) return null;
  const xml = await res.text();
  // An unposted week comes back as an HTML error page rather than a 404.
  if (!/<\?xml|<floorschedule|<category|<floor-item|<legis-num/i.test(xml)) return null;
  return { items: parseFloorXml(xml, congress), url };
}

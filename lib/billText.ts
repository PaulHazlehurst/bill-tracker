// Fetching and reading a bill's text, one published version at a time.
//
// Every version of a bill (introduced, reported, engrossed, enrolled...) is
// a separate GovInfo "package" with an id like BILLS-119hr4120ih, where the
// last letters are the version ("ih" = introduced in the House, "rh" =
// reported in the House, and so on). The structured XML version marks up
// each section with its number and heading, which is what lets the
// comparison line sections up properly. The plain-text version is the
// fallback.
//
// The parsing functions are pure and tested in tests/billText.test.ts.

import { decodeEntities } from "@/lib/houseFloor";
import type { Section } from "@/lib/textDiff";

const MAX_BYTES = 6_000_000;

export const VERSION_NAMES: Record<string, string> = {
  ih: "Introduced in House",
  is: "Introduced in Senate",
  rh: "Reported in House",
  rs: "Reported in Senate",
  rfh: "Referred in House",
  rfs: "Referred in Senate",
  rds: "Received in Senate",
  rhs: "Received in House",
  eh: "Engrossed in House",
  es: "Engrossed in Senate",
  eah: "Engrossed Amendment House",
  eas: "Engrossed Amendment Senate",
  enr: "Enrolled (sent to the President)",
  pcs: "Placed on Calendar Senate",
  pch: "Placed on Calendar House",
  ats: "Agreed to Senate",
  ath: "Agreed to House",
  cps: "Considered and Passed Senate",
  cph: "Considered and Passed House",
};

export function packageIdFromUrl(url: string): string | null {
  const m = url.match(/(BILLS-\d{2,3}[a-z]+\d+[a-z]+)(?=[./]|$)/i);
  return m ? m[1].replace(/^bills/i, "BILLS") : null;
}

export function versionCode(packageId: string): string {
  return packageId.match(/^BILLS-\d{2,3}[a-z]+?\d+([a-z]+)$/i)?.[1]?.toLowerCase() ?? "";
}

export type TextVersionInput = { type: string; date: string | null; formats: { type: string; url: string }[] };
export type ComparableVersion = { packageId: string; label: string; date: string | null; xmlUrl: string | null; textUrl: string | null };

/** The versions that can be compared, oldest first. */
export function comparableVersions(versions: TextVersionInput[]): ComparableVersion[] {
  const out: ComparableVersion[] = [];
  const seen = new Set<string>();
  for (const v of versions) {
    const pkg = v.formats.map((f) => packageIdFromUrl(f.url)).find(Boolean);
    if (!pkg || seen.has(pkg)) continue;
    seen.add(pkg);
    out.push({
      packageId: pkg,
      label: v.type || VERSION_NAMES[versionCode(pkg)] || pkg,
      date: v.date ? String(v.date).slice(0, 10) : null,
      xmlUrl: v.formats.find((f) => /xml/i.test(f.type) || /\.xml$/i.test(f.url))?.url ?? null,
      textUrl: v.formats.find((f) => /text|htm/i.test(f.type) || /\.htm$/i.test(f.url))?.url ?? null,
    });
  }
  // congress.gov lists newest first; dates can be missing on some versions,
  // so keep the listed order as the tiebreaker.
  return out
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (a.v.date && b.v.date ? a.v.date.localeCompare(b.v.date) : b.i - a.i))
    .map((x) => x.v);
}

function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Splits bill XML into its top-level sections. Sections quoted inside an
 * amendment to existing law (<quoted-block>) belong to the section that
 * quotes them, so they aren't split out.
 */
export function parseBillSections(xml: string): Section[] {
  const clean = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/i, "");
  const bodyMatch = clean.match(/<(legis-body|resolution-body|engrossed-amendment-body)\b[^>]*>([\s\S]*)<\/\1>/i);
  const src = bodyMatch ? bodyMatch[2] : clean;

  const sections: Section[] = [];
  const stack: string[] = [];
  let openAt = -1;
  let openDepth = -1;
  const tagRx = /<(\/?)([a-zA-Z][\w:.-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRx.exec(src))) {
    const [, closing, rawName, , selfClosing] = m;
    const name = rawName.toLowerCase();
    if (selfClosing) continue;
    if (!closing) {
      if (name === "section" && openAt < 0 && !stack.includes("quoted-block")) {
        openAt = m.index;
        openDepth = stack.length;
      }
      stack.push(name);
    } else {
      // Pop back to the matching open tag (tolerates sloppy markup).
      const idx = stack.lastIndexOf(name);
      if (idx >= 0) stack.length = idx;
      if (name === "section" && openAt >= 0 && stack.length === openDepth) {
        sections.push(sectionFrom(src.slice(openAt, m.index + m[0].length), sections.length));
        openAt = -1;
        openDepth = -1;
      }
    }
  }

  if (!sections.length) {
    const text = textOf(src);
    return text ? [{ key: "text", num: "", header: "Text", text }] : [];
  }
  return dedupeKeys(sections);
}

function sectionFrom(fragment: string, index: number): Section {
  const enumMatch = fragment.match(/<enum\b[^>]*>([\s\S]*?)<\/enum>/i);
  const headerMatch = fragment.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i);
  const num = enumMatch ? textOf(enumMatch[1]).replace(/\.$/, "") : "";
  const header = headerMatch ? textOf(headerMatch[1]) : "";
  let body = fragment;
  if (enumMatch) body = body.replace(enumMatch[0], " ");
  if (headerMatch) body = body.replace(headerMatch[0], " ");
  return { key: `${num || index}|${header.toLowerCase()}`, num, header: sentenceCase(header), text: textOf(body) };
}

/** Plain-text fallback: splits on "SEC. 3. HEADING." lines. */
export function parsePlainSections(raw: string): Section[] {
  const text = textOf(raw.replace(/<pre[^>]*>/i, "").replace(/<\/pre>/i, ""))
    // textOf collapsed newlines; put breaks back before section headings.
    .replace(/\s((?:SEC\.|SECTION)\s+\d+[A-Z]?\.)/g, "\n$1");
  const parts = text.split("\n");
  const sections: Section[] = [];
  for (const part of parts) {
    const m = part.match(/^(?:SEC\.|SECTION)\s+(\d+[A-Z]?)\.\s+([^.]{1,200}?)\.\s+([\s\S]*)$/);
    if (m) sections.push({ key: `${m[1]}|${m[2].toLowerCase()}`, num: m[1], header: sentenceCase(m[2]), text: m[3].trim() });
    else if (part.trim() && sections.length === 0) sections.push({ key: "preamble", num: "", header: "Opening", text: part.trim() });
    else if (part.trim()) sections[sections.length - 1].text += ` ${part.trim()}`;
  }
  return dedupeKeys(sections);
}

function dedupeKeys(sections: Section[]): Section[] {
  const seen = new Map<string, number>();
  return sections.map((s) => {
    const n = seen.get(s.key) ?? 0;
    seen.set(s.key, n + 1);
    return n ? { ...s, key: `${s.key}#${n + 1}` } : s;
  });
}

/** Section headings are often printed in capitals in the plain-text version. */
function sentenceCase(s: string) {
  if (!s || s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export class TextTooLargeError extends Error {}

async function getText(url: string, init: RequestInit = {}): Promise<string | null> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (!res.ok) return null;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new TextTooLargeError(url);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new TextTooLargeError(url);
  return text;
}

/** Fetches one version and splits it into sections. GovInfo's public files first, then the API. */
export async function fetchVersionSections(v: ComparableVersion): Promise<Section[]> {
  const id = v.packageId;
  const key = process.env.GOVINFO_API_KEY || process.env.CONGRESS_API_KEY;
  const xmlSources = [
    `https://www.govinfo.gov/content/pkg/${id}/xml/${id}.xml`,
    key ? `https://api.govinfo.gov/packages/${id}/xml?api_key=${key}` : null,
    v.xmlUrl,
  ].filter(Boolean) as string[];
  for (const url of xmlSources) {
    try {
      const xml = await getText(url);
      if (xml && /<(bill|resolution|legis-body|section)\b/i.test(xml)) {
        const sections = parseBillSections(xml);
        if (sections.length) return sections;
      }
    } catch (err) {
      if (err instanceof TextTooLargeError) throw err;
    }
  }
  const textSources = [
    `https://www.govinfo.gov/content/pkg/${id}/html/${id}.htm`,
    key ? `https://api.govinfo.gov/packages/${id}/htm?api_key=${key}` : null,
    v.textUrl,
  ].filter(Boolean) as string[];
  for (const url of textSources) {
    try {
      const htm = await getText(url);
      if (htm) {
        const sections = parsePlainSections(htm);
        if (sections.length) return sections;
      }
    } catch (err) {
      if (err instanceof TextTooLargeError) throw err;
    }
  }
  throw new Error(`Couldn't download the text of ${id}`);
}

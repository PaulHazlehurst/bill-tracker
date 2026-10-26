// A tiny iCalendar (.ics) writer for the subscribe-able calendar feed.
// Pure, so it's tested directly. Follows RFC 5545: CRLF line endings,
// escaped text, and lines folded at 75 octets.

export type IcsEvent = {
  uid: string;
  title: string;
  /** ISO timestamp for a timed event... */
  start?: string;
  durationMinutes?: number;
  /** ...or YYYY-MM-DD for an all-day event. */
  allDay?: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  cancelled?: boolean;
};

export function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line to 75 octets, continuation lines starting with a space. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines lose one octet to the leading space
    if (currentBytes + n > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += n;
  }
  out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join("\r\n");
}

function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildIcs(events: IcsEvent[], opts: { name: string; now?: Date }): string {
  const now = stamp((opts.now ?? new Date()).toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bill Tracker//Week ahead//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(opts.name)}`,
    "X-WR-TIMEZONE:America/New_York",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${now}`);
    if (e.allDay) {
      const d = e.allDay.replace(/-/g, "");
      const next = new Date(`${e.allDay}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`);
    } else if (e.start) {
      lines.push(`DTSTART:${stamp(e.start)}`, `DURATION:PT${Math.max(15, e.durationMinutes ?? 120)}M`);
    }
    lines.push(`SUMMARY:${escapeIcsText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeIcsText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.cancelled) lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

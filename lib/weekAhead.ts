// Builds the Week ahead view: which committee meetings and floor items
// matter to you, laid out by day in Washington time. Pure (no I/O), so the
// page, the team email and the calendar feed all share it and it's tested
// directly.

import { citationFor } from "@/lib/billMeta";
import { addDays } from "@/lib/houseFloor";
import type { FloorItem } from "@/lib/houseFloor";
import type { MeetingRow } from "@/lib/meetings";

export type Relevance =
  | { kind: "tracked"; billId: string }
  | { kind: "client"; billId: string; client: string }
  | { kind: "suggested"; billId: string }
  | { kind: "topic"; topic: string };

export type WeekBill = { billId: string; citation: string; tracked: boolean; suggested: boolean; clients: string[] };

export type WeekEvent = {
  id: string;
  day: string;                   // YYYY-MM-DD in Washington time
  time: string | null;           // "10:00 AM", null when no time was given
  startsAt: string | null;       // ISO
  title: string;
  kind: "Hearing" | "Markup" | "Meeting";
  status: string;                // Scheduled | Canceled | Postponed | Rescheduled
  chamber: string;
  committees: string[];
  location: string | null;
  bills: WeekBill[];
  relevance: Relevance[];
  witnessCount: number;
  documentCount: number;
  videoUrl: string | null;
  url: string;
};

export type WeekDay = { day: string; weekday: string; dayOfMonth: number; events: WeekEvent[] };

export type WeekContext = {
  tracked: Set<string>;
  suggested: Set<string>;
  topics: string[];
  /** bill id -> client names that follow it */
  clients?: Map<string, string[]>;
};

const TZ = "America/New_York";
const STOP = new Set(["a", "an", "the", "of", "and", "or", "for", "to", "in", "on", "act", "bill", "with", "from", "by"]);

function stem(w: string) {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(ss|sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 6 && w.endsWith("ing")) return w.slice(0, -3);
  return w;
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

/** True when every meaningful word of the topic appears in the text. */
export function topicMatches(topic: string, text: string): boolean {
  const need = words(topic);
  if (!need.length) return false;
  const have = new Set(words(text));
  // Also allow a topic word to appear inside a longer word ("telehealth" in "telehealth-related").
  const joined = ` ${Array.from(have).join(" ")} `;
  return need.every((w) => have.has(w) || (w.length >= 5 && joined.includes(w)));
}

/** Markups are where bills move. House labels them; Senate committees call them executive sessions or business meetings. */
export function isMarkup(meetingType: string | null, title: string | null): boolean {
  if ((meetingType ?? "").toLowerCase() === "markup") return true;
  return /\bmark-?up\b|executive session|business meeting/i.test(title ?? "");
}

export function dayInWashington(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function timeInWashington(iso: string): string | null {
  const t = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  // congress.gov sometimes stores a date with no time, which reads as midnight.
  return t === "12:00 AM" ? null : t;
}

function weekdayLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function eventFromMeeting(m: MeetingRow & { url?: string }, ctx: WeekContext): WeekEvent | null {
  if (!m.meeting_at) return null;
  const bills: WeekBill[] = m.bill_ids.map((id) => ({
    billId: id,
    citation: citationFor(id),
    tracked: ctx.tracked.has(id),
    suggested: ctx.suggested.has(id),
    clients: ctx.clients?.get(id) ?? [],
  }));
  const relevance: Relevance[] = [];
  for (const b of bills) {
    if (b.tracked) relevance.push({ kind: "tracked", billId: b.billId });
    for (const c of b.clients) relevance.push({ kind: "client", billId: b.billId, client: c });
    if (!b.tracked && b.suggested) relevance.push({ kind: "suggested", billId: b.billId });
  }
  for (const t of ctx.topics) {
    if (topicMatches(t, m.title ?? "")) relevance.push({ kind: "topic", topic: t });
  }
  const kind: WeekEvent["kind"] = isMarkup(m.meeting_type, m.title) ? "Markup" : (m.meeting_type ?? "").toLowerCase() === "hearing" ? "Hearing" : "Meeting";
  return {
    id: m.event_id,
    day: dayInWashington(m.meeting_at),
    time: timeInWashington(m.meeting_at),
    startsAt: m.meeting_at,
    title: m.title ?? "Committee meeting",
    kind,
    status: m.status ?? "Scheduled",
    chamber: m.chamber,
    committees: m.committees.map((c) => c.name),
    location: m.location,
    bills,
    relevance,
    witnessCount: m.witness_count,
    documentCount: m.document_count,
    videoUrl: m.video_url,
    url: m.url ?? "",
  };
}

export type FloorView = FloorItem & { tracked: boolean; suggested: boolean; clients: string[] };

export type WeekView = {
  start: string;
  days: WeekDay[];
  floor: FloorView[];
  /** Counts for the headline, always over YOUR items (not "everything"). */
  counts: { meetings: number; markups: number; floor: number };
};

/**
 * Lays out one week (Monday to Sunday; weekend days only appear when
 * something is on them). `scope: "mine"` keeps only meetings and floor
 * items that touch your bills, clients or topics.
 */
export function buildWeek(start: string, meetings: (MeetingRow & { url?: string })[], floorItems: FloorItem[], ctx: WeekContext, scope: "mine" | "all" = "mine"): WeekView {
  const dayList = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const all = meetings.map((m) => eventFromMeeting(m, ctx)).filter((e): e is WeekEvent => !!e && dayList.includes(e.day));
  const mine = all.filter((e) => e.relevance.length > 0);
  const shown = scope === "mine" ? mine : all;

  const rank = (e: WeekEvent) => (e.relevance.length ? 0 : 1);
  const days: WeekDay[] = dayList
    .map((day, i) => ({
      day,
      weekday: weekdayLabel(day),
      dayOfMonth: Number(day.slice(8, 10)),
      events: shown
        .filter((e) => e.day === day)
        .sort((a, b) => rank(a) - rank(b) || String(a.startsAt).localeCompare(String(b.startsAt))),
      weekend: i >= 5,
    }))
    .filter((d) => !d.weekend || d.events.length > 0)
    .map(({ weekend: _w, ...d }) => d);

  const floorAll: FloorView[] = floorItems.map((f) => ({
    ...f,
    tracked: !!f.billId && ctx.tracked.has(f.billId),
    suggested: !!f.billId && ctx.suggested.has(f.billId),
    clients: (f.billId && ctx.clients?.get(f.billId)) || [],
  }));
  const floorMine = floorAll.filter((f) => f.tracked || f.suggested || f.clients.length || ctx.topics.some((t) => topicMatches(t, f.title)));
  const floor = scope === "mine" ? floorMine : floorAll;

  return {
    start,
    days,
    floor,
    // Cancelled and postponed meetings stay on the page (crossed out) but don't count.
    counts: {
      meetings: mine.filter((e) => e.status === "Scheduled").length,
      markups: mine.filter((e) => e.status === "Scheduled" && e.kind === "Markup").length,
      floor: floorMine.length,
    },
  };
}

/** One plain sentence describing the week, for the page header and the team email. */
export function weekHeadline(view: WeekView): string {
  const { meetings, markups, floor } = view.counts;
  if (!meetings && !floor) return "Nothing on the schedule touches your bills or topics yet. Committees usually post notices about a week ahead.";
  const parts: string[] = [];
  if (meetings) parts.push(`${meetings} committee meeting${meetings === 1 ? "" : "s"} touch${meetings === 1 ? "es" : ""} your bills or topics`);
  if (floor) parts.push(`${floor} of your bills ${floor === 1 ? "is" : "are"} on the House floor schedule`);
  let s = parts.join(", and ") + ".";
  if (markups) s += ` ${markups === 1 ? "One is a markup" : `${markups} are markups`}, where a bill can be voted out of committee.`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Short, plain reason a meeting is on your week. */
export function relevanceLabel(r: Relevance): string {
  switch (r.kind) {
    case "tracked":
      return `You track ${citationFor(r.billId)}`;
    case "client":
      return `${r.client} follows ${citationFor(r.billId)}`;
    case "suggested":
      return `${citationFor(r.billId)} is a suggestion`;
    case "topic":
      return `Matches your topic: ${r.topic}`;
  }
}

/** Plain reasons for one event, most important first, with bills grouped ("You track H.R. 1 and S. 2"). */
export function reasonsFor(e: Pick<WeekEvent, "relevance">): string[] {
  const list = (ids: string[]) => {
    const c = Array.from(new Set(ids)).map((id) => citationFor(id));
    return c.length <= 2 ? c.join(" and ") : `${c.slice(0, -1).join(", ")} and ${c[c.length - 1]}`;
  };
  const tracked = e.relevance.filter((r): r is Extract<Relevance, { kind: "tracked" }> => r.kind === "tracked").map((r) => r.billId);
  const suggested = e.relevance.filter((r): r is Extract<Relevance, { kind: "suggested" }> => r.kind === "suggested").map((r) => r.billId);
  const byClient = new Map<string, string[]>();
  for (const r of e.relevance) if (r.kind === "client") byClient.set(r.client, [...(byClient.get(r.client) ?? []), r.billId]);
  const out: string[] = [];
  if (tracked.length) out.push(`You track ${list(tracked)}`);
  for (const [client, ids] of byClient) out.push(`${client} follows ${list(ids)}`);
  if (suggested.length) out.push(`${list(suggested)} ${new Set(suggested).size === 1 ? "is a suggestion" : "are suggestions"}`);
  for (const r of e.relevance) if (r.kind === "topic") out.push(relevanceLabel(r));
  return Array.from(new Set(out));
}

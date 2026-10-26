// SERVER-ONLY. Keeps a local copy of congress.gov committee meetings and the
// House floor schedule for the Week ahead page.
//
// Why a local copy: congress.gov's committee-meeting list can only be
// filtered by when a record was last EDITED, not by when the meeting is
// held, and each meeting's date lives in a separate detail record. So "what
// is happening next Tuesday" can't be asked of congress.gov directly. We
// fetch every meeting record edited since the last sync (committees post
// and update notices days ahead), keep them in committee_meetings, and
// answer date questions from there. Only records whose edit time changed
// are re-fetched, so a normal daily sync is a few dozen requests.

import { trackedFetch } from "@/lib/apiUsageTracker";
import { mapLimit, deadline, chunk } from "@/lib/batch";
import { congressForDate } from "@/lib/billMeta";
import { fetchFloorWeek, weekMonday, addDays } from "@/lib/houseFloor";

type Admin = any;

const BASE_URL = "https://api.congress.gov/v3";
const CHAMBERS = ["house", "senate"] as const;
const FIRST_SYNC_DAYS = 30;
const PAGE_LIMIT = 250;
const MAX_PAGES = 8;
const DETAIL_CONCURRENCY = 6;
const LOCK_MS = 75_000;
const MEETINGS_KEY = "committee_meetings";
export const STALE_AFTER_MS = 3 * 3_600_000;

export type MeetingRow = {
  event_id: string;
  congress: number;
  chamber: string;
  meeting_at: string | null;
  title: string | null;
  meeting_type: string | null;
  status: string | null;
  committees: { name: string; systemCode: string | null }[];
  location: string | null;
  bill_ids: string[];
  witness_count: number;
  document_count: number;
  video_url: string | null;
  source_updated_at: string | null;
};

/** congress.gov writes dates two ways ("2026-10-27T14:00:00Z" and "2026-10-27 14:00:00+00:00"). Both -> ISO. */
export function parseApiDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim().replace(" ", "T");
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asArray<T = any>(v: any): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.item)) return v.item;
  if (v.item) return [v.item];
  return [v];
}

/** congress.gov detail record -> our row. Pure, so it's tested directly. */
export function normalizeMeeting(detail: any, fallbackChamber = "House"): MeetingRow | null {
  if (!detail || detail.eventId == null) return null;
  const loc = detail.location ?? {};
  const room = typeof loc.room === "string" ? loc.room.trim() : "";
  const building = typeof loc.building === "string" ? loc.building.trim() : "";
  const location = room.toUpperCase() === "WEBEX" ? "Online" : [building, room ? `Room ${room}` : ""].filter(Boolean).join(", ") || (loc.address ? String(loc.address.city ?? loc.address.street ?? "Field hearing") : null);

  const bills = asArray(detail.relatedItems?.bills ?? detail.relatedItems?.bill);
  const billIds = Array.from(
    new Set(
      bills
        .filter((b: any) => b && b.type && b.number)
        .map((b: any) => `${String(b.type).toLowerCase()}-${Number(b.number)}-${Number(b.congress ?? detail.congress)}`),
    ),
  );

  return {
    event_id: String(detail.eventId),
    congress: Number(detail.congress) || congressForDate(),
    chamber: detail.chamber ?? fallbackChamber,
    meeting_at: parseApiDate(detail.date),
    title: typeof detail.title === "string" ? detail.title.replace(/\s+/g, " ").trim() : null,
    meeting_type: detail.type ?? null,
    status: detail.meetingStatus ?? null,
    committees: asArray(detail.committees).map((c: any) => ({ name: String(c.name ?? "").trim(), systemCode: c.systemCode ?? null })).filter((c) => c.name),
    location: location || null,
    bill_ids: billIds,
    witness_count: asArray(detail.witnesses).length,
    document_count: asArray(detail.meetingDocuments).length + asArray(detail.witnessDocuments).length,
    video_url: asArray(detail.videos)[0]?.url ?? null,
    source_updated_at: parseApiDate(detail.updateDate),
  };
}

/** The congress.gov page for a meeting. */
export function meetingPageUrl(row: Pick<MeetingRow, "event_id" | "congress" | "chamber">): string {
  const n = row.congress;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  const chamber = String(row.chamber).toLowerCase() === "senate" ? "senate" : "house";
  return `https://www.congress.gov/event/${n}${suffix}-congress/${chamber}-event/${row.event_id}`;
}

function apiKey() {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) throw new Error("CONGRESS_API_KEY is not set");
  return key;
}

type ListItem = { eventId: string; url: string; updated: string | null; chamber: string };

async function listUpdatedSince(congress: number, chamber: string, fromIso: string, toIso: string, clock: ReturnType<typeof deadline>): Promise<ListItem[]> {
  const out: ListItem[] = [];
  for (let page = 0; page < MAX_PAGES && !clock.expired(); page++) {
    const url = new URL(`${BASE_URL}/committee-meeting/${congress}/${chamber}`);
    url.searchParams.set("api_key", apiKey());
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(page * PAGE_LIMIT));
    // These filter on when the record was last edited (see the note at the top).
    url.searchParams.set("fromDateTime", fromIso.replace(/\.\d{3}Z$/, "Z"));
    url.searchParams.set("toDateTime", toIso.replace(/\.\d{3}Z$/, "Z"));
    const res = await trackedFetch(url.toString(), { cache: "no-store" }, "congress_gov");
    if (!res.ok) throw new Error(`congress.gov committee meetings list failed: ${res.status}`);
    const data = await res.json();
    const items = asArray(data.committeeMeetings);
    for (const m of items) {
      if (m?.eventId == null || !m.url) continue;
      out.push({ eventId: String(m.eventId), url: m.url, updated: parseApiDate(m.updateDate), chamber: m.chamber ?? chamber });
    }
    if (items.length < PAGE_LIMIT) break;
  }
  return out;
}

async function fetchDetail(url: string): Promise<any | null> {
  const withKey = new URL(url);
  withKey.searchParams.set("api_key", apiKey());
  withKey.searchParams.set("format", "json");
  const res = await trackedFetch(withKey.toString(), { cache: "no-store" }, "congress_gov");
  if (!res.ok) return null;
  const data = await res.json();
  return data.committeeMeeting ?? null;
}

async function takeLock(admin: Admin, key: string): Promise<{ ok: boolean; cursor: string | null; lastRunAt: string | null }> {
  const { data, error } = await admin.from("sync_state").select("cursor, last_run_at, locked_until").eq("key", key).maybeSingle();
  if (error) throw new Error(`sync_state unavailable: ${error.message}`);
  if (data?.locked_until && new Date(data.locked_until).getTime() > Date.now()) return { ok: false, cursor: data.cursor, lastRunAt: data.last_run_at };
  await admin.from("sync_state").upsert({ key, cursor: data?.cursor ?? null, last_run_at: data?.last_run_at ?? null, locked_until: new Date(Date.now() + LOCK_MS).toISOString() });
  return { ok: true, cursor: data?.cursor ?? null, lastRunAt: data?.last_run_at ?? null };
}

export type MeetingSyncResult = { skipped?: string; listed: number; changed: number; saved: number; complete: boolean; ms: number };

/** Fetches committee meetings edited since the last sync. Resumable: an unfinished run picks up next time. */
export async function syncCommitteeMeetings(admin: Admin, budgetMs: number): Promise<MeetingSyncResult> {
  const clock = deadline(budgetMs);
  const lock = await takeLock(admin, MEETINGS_KEY);
  if (!lock.ok) return { skipped: "another sync is running", listed: 0, changed: 0, saved: 0, complete: false, ms: clock.elapsedMs() };

  const startedAt = new Date();
  const congress = congressForDate(startedAt);
  const fromIso = lock.cursor ?? new Date(startedAt.getTime() - FIRST_SYNC_DAYS * 86_400_000).toISOString();
  let listed = 0;
  let changed = 0;
  let saved = 0;
  let complete = false;

  try {
    const lists = await Promise.all(CHAMBERS.map((c) => listUpdatedSince(congress, c, fromIso, startedAt.toISOString(), clock)));
    const byId = new Map<string, ListItem>();
    for (const item of lists.flat()) {
      const prev = byId.get(item.eventId);
      if (!prev || String(item.updated ?? "") > String(prev.updated ?? "")) byId.set(item.eventId, item);
    }
    listed = byId.size;

    // Skip records we already have at the same edit time.
    const known = new Map<string, string | null>();
    for (const ids of chunk(Array.from(byId.keys()), 200)) {
      const { data } = await admin.from("committee_meetings").select("event_id, source_updated_at").in("event_id", ids);
      for (const r of (data as any[]) ?? []) known.set(r.event_id, r.source_updated_at);
    }
    const todo = Array.from(byId.values()).filter((i) => !known.has(i.eventId) || known.get(i.eventId) !== i.updated);
    changed = todo.length;

    let unfinished = 0;
    const rows = await mapLimit(todo, DETAIL_CONCURRENCY, async (item) => {
      if (clock.expired()) {
        unfinished++;
        return null;
      }
      try {
        const row = normalizeMeeting(await fetchDetail(item.url), item.chamber);
        // Store the list's edit time, so the next comparison is like for like.
        return row ? { ...row, source_updated_at: item.updated ?? row.source_updated_at, fetched_at: new Date().toISOString() } : null;
      } catch {
        unfinished++;
        return null;
      }
    });
    const good = rows.filter(Boolean) as (MeetingRow & { fetched_at: string })[];
    for (const part of chunk(good, 100)) {
      const { error } = await admin.from("committee_meetings").upsert(part, { onConflict: "event_id" });
      if (error) throw new Error(`couldn't save committee meetings: ${error.message}`);
      saved += part.length;
    }
    complete = unfinished === 0 && !clock.expired();
  } finally {
    await admin.from("sync_state").upsert({
      key: MEETINGS_KEY,
      // Only move the cursor forward once everything up to now is saved.
      cursor: complete ? new Date(startedAt.getTime() - 5 * 60_000).toISOString() : lock.cursor,
      last_run_at: complete ? startedAt.toISOString() : lock.lastRunAt,
      locked_until: null,
    });
  }
  return { listed, changed, saved, complete, ms: clock.elapsedMs() };
}

/** Refreshes this week's and next week's House floor schedule if older than three hours. */
export async function syncHouseFloor(admin: Admin, now = new Date()): Promise<{ weeks: { week: string; items: number | null }[] }> {
  const congress = congressForDate(now);
  const thisWeek = weekMonday(now);
  const weeks = [thisWeek, addDays(thisWeek, 7)];
  const { data: existing } = await admin.from("floor_weeks").select("week_of, fetched_at").in("week_of", weeks);
  const fresh = new Map(((existing as any[]) ?? []).map((r) => [r.week_of, r.fetched_at]));
  const out: { week: string; items: number | null }[] = [];
  for (const week of weeks) {
    const at = fresh.get(week);
    if (at && Date.now() - new Date(at).getTime() < STALE_AFTER_MS) {
      out.push({ week, items: null });
      continue;
    }
    try {
      const result = await fetchFloorWeek(week, congress);
      await admin.from("floor_weeks").upsert({ week_of: week, items: result?.items ?? [], source_url: result?.url ?? null, fetched_at: new Date().toISOString() });
      out.push({ week, items: result?.items.length ?? 0 });
    } catch (err) {
      console.error("house floor fetch failed", err);
      out.push({ week, items: null });
    }
  }
  return { weeks: out };
}

/** Everything Week ahead needs, within a time budget. Used by the morning job and by the page's refresh. */
export async function syncWeekAhead(admin: Admin, budgetMs: number) {
  // Until migration 0002 is run there's nowhere to keep the schedule, so
  // don't spend congress.gov requests fetching it.
  const { error: notReady } = await admin.from("committee_meetings").select("event_id").limit(1);
  if (notReady) return { skipped: "Week ahead tables not set up yet (supabase/migrations/0002_week_ahead.sql)" };
  const started = Date.now();
  const floor = await syncHouseFloor(admin).catch((err) => ({ error: String(err?.message ?? err) }));
  const meetings = await syncCommitteeMeetings(admin, Math.max(3_000, budgetMs - (Date.now() - started))).catch((err) => ({ error: String(err?.message ?? err) }));
  return { floor, meetings };
}

/** When the meetings were last fully synced, or null if never. */
export async function lastMeetingSync(admin: Admin): Promise<string | null> {
  const { data } = await admin.from("sync_state").select("last_run_at").eq("key", MEETINGS_KEY).maybeSingle();
  return data?.last_run_at ?? null;
}

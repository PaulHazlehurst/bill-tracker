// SERVER-ONLY. Loads everything the Week ahead view needs for one person.
// Works with either the signed-in client (row-level security decides what
// it sees) or the admin client (the calendar feed, which has no session),
// because it scopes every query to the person's own team explicitly.

import { buildWeek, type WeekContext, type WeekView } from "@/lib/weekAhead";
import { addDays } from "@/lib/houseFloor";
import { meetingPageUrl, type MeetingRow } from "@/lib/meetings";
import type { FloorItem } from "@/lib/houseFloor";

type Db = any;

export type Deadline = { id: string; title: string; closes: string; agency: string | null; url: string | null; docType: string | null; topic: string };

export async function loadWeekContext(db: Db, userId: string): Promise<WeekContext & { orgId: string | null; memberIds: string[] }> {
  const { data: profile } = await db.from("profiles").select("organization_id, topics").eq("id", userId).maybeSingle();
  const orgId: string | null = profile?.organization_id ?? null;
  let topics: string[] = profile?.topics ?? [];
  let memberIds = [userId];
  if (orgId) {
    const [{ data: org }, { data: members }] = await Promise.all([
      db.from("organizations").select("topics").eq("id", orgId).maybeSingle(),
      db.from("profiles").select("id").eq("organization_id", orgId),
    ]);
    topics = org?.topics ?? [];
    memberIds = Array.from(new Set([userId, ...((members as any[]) ?? []).map((m) => m.id)]));
  }

  const suggestedQuery = db.from("prospective_bills").select("bill_id").eq("dismissed", false);
  const clientsQuery = db.from("clients").select("name, client_bills(bill_id)");
  const [{ data: tracked }, { data: suggested }, clientsResult] = await Promise.all([
    db.from("tracked_bills").select("bill_id").in("user_id", memberIds),
    orgId ? suggestedQuery.eq("organization_id", orgId) : suggestedQuery.eq("user_id", userId),
    orgId ? clientsQuery.eq("organization_id", orgId) : clientsQuery.eq("user_id", userId),
  ]);

  // Clients arrive with migration 0004; until then this is simply empty.
  const clients = new Map<string, string[]>();
  if (!clientsResult.error) {
    for (const c of (clientsResult.data as any[]) ?? []) {
      for (const cb of c.client_bills ?? []) {
        const list = clients.get(cb.bill_id) ?? [];
        if (!list.includes(c.name)) list.push(c.name);
        clients.set(cb.bill_id, list);
      }
    }
  }

  return {
    orgId,
    memberIds,
    topics: topics.filter(Boolean),
    tracked: new Set(((tracked as any[]) ?? []).map((t) => t.bill_id)),
    suggested: new Set(((suggested as any[]) ?? []).map((s) => s.bill_id)),
    clients,
  };
}

export async function loadMeetings(db: Db, start: string, days = 7): Promise<{ rows: (MeetingRow & { url: string })[]; ready: boolean }> {
  // A day of slack either side covers the Washington/UTC offset.
  const from = `${addDays(start, -1)}T00:00:00Z`;
  const to = `${addDays(start, days + 1)}T00:00:00Z`;
  const { data, error } = await db
    .from("committee_meetings")
    .select("event_id, congress, chamber, meeting_at, title, meeting_type, status, committees, location, bill_ids, witness_count, document_count, video_url, source_updated_at")
    .gte("meeting_at", from)
    .lt("meeting_at", to)
    .order("meeting_at", { ascending: true })
    .limit(1000);
  if (error) return { rows: [], ready: false };
  return { rows: ((data as MeetingRow[]) ?? []).map((m) => ({ ...m, url: meetingPageUrl(m) })), ready: true };
}

export async function loadFloor(db: Db, start: string): Promise<{ items: FloorItem[]; fetchedAt: string | null; sourceUrl: string | null }> {
  const { data } = await db.from("floor_weeks").select("items, fetched_at, source_url").eq("week_of", start).maybeSingle();
  return { items: (data?.items as FloorItem[]) ?? [], fetchedAt: data?.fetched_at ?? null, sourceUrl: data?.source_url ?? null };
}

export async function loadDeadlines(db: Db, ctx: { orgId: string | null }, userId: string, today: string, horizonDays = 45): Promise<Deadline[]> {
  let q = db
    .from("prospective_regulations")
    .select("id, matched_topic, regulations!inner(id, title, comment_close_date, agencies, html_url, doc_type)")
    .eq("dismissed", false)
    .gte("regulations.comment_close_date", today)
    .lte("regulations.comment_close_date", addDays(today, horizonDays))
    .limit(50);
  q = ctx.orgId ? q.eq("organization_id", ctx.orgId) : q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) return [];
  const out: Deadline[] = [];
  const seen = new Set<string>();
  for (const r of (data as any[]) ?? []) {
    const reg = Array.isArray(r.regulations) ? r.regulations[0] : r.regulations;
    if (!reg?.comment_close_date || seen.has(reg.id)) continue;
    seen.add(reg.id);
    const agencies = Array.isArray(reg.agencies) ? reg.agencies : [];
    // Stored as display names (lib/federalRegister-api.ts).
    const agency = typeof agencies[0] === "string" ? agencies[0] : agencies[0]?.name ?? null;
    out.push({ id: reg.id, title: reg.title, closes: reg.comment_close_date, agency, url: reg.html_url ?? null, docType: reg.doc_type ?? null, topic: r.matched_topic });
  }
  return out.sort((a, b) => a.closes.localeCompare(b.closes));
}

export async function loadWeekView(db: Db, userId: string, start: string, scope: "mine" | "all") {
  const ctx = await loadWeekContext(db, userId);
  const [meetings, floor] = await Promise.all([loadMeetings(db, start), loadFloor(db, start)]);
  const view: WeekView = buildWeek(start, meetings.rows, floor.items, ctx, scope);
  return { ctx, view, meetingsReady: meetings.ready, floor };
}

export type BoardItem = { id: string; day: string; state: string; title: string; kind: string; time: string | null; url: string | null; source: "team" | "website" };

/**
 * State drug board dates in a date range: what the team added, plus any
 * agenda on a board's website dated in the range (unless the team already
 * added that board's meeting for the same day). Empty until migration 0005.
 */
export async function loadBoardItems(db: Db, from: string, to: string): Promise<BoardItem[]> {
  const [{ data: dates, error }, { data: agendas }] = await Promise.all([
    db.from("board_dates").select("*").gte("date", from).lte("date", to).order("date"),
    db.from("board_documents").select("id, state, doc_date, title, url").eq("kind", "agenda").gte("doc_date", from).lte("doc_date", to),
  ]);
  if (error) return [];
  const items: BoardItem[] = ((dates as any[]) ?? []).map((d) => ({ id: d.id, day: d.date, state: d.state, title: d.title, kind: d.kind, time: d.time, url: d.url, source: d.source === "document" ? ("website" as const) : ("team" as const) }));
  const taken = new Set(items.filter((i) => i.kind === "meeting").map((i) => `${i.state}|${i.day}`));
  for (const a of (agendas as any[]) ?? []) {
    if (taken.has(`${a.state}|${a.doc_date}`)) continue;
    taken.add(`${a.state}|${a.doc_date}`);
    items.push({ id: a.id, day: a.doc_date, state: a.state, title: a.title || "Board meeting", kind: "meeting", time: null, url: a.url, source: "website" });
  }
  return items.sort((a, b) => a.day.localeCompare(b.day) || a.state.localeCompare(b.state));
}

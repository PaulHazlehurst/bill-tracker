// SERVER-ONLY. Gathers what a client's report needs from the database and
// hands it to buildClientReport. Works with the signed-in client (RLS) or
// the admin client (the Monday job and the public link).

import { buildClientReport, type ClientReport, type ReportBill, type ReportEvent } from "@/lib/clientReport";
import { weekMonday, type FloorItem } from "@/lib/houseFloor";
import type { MeetingRow } from "@/lib/meetings";

type Db = any;

export type ClientRow = {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  name: string;
  notes: string | null;
  lead_user_id: string | null;
  report_enabled: boolean;
  report_ask: string | null;
  share_token: string | null;
  created_at: string;
  updated_at: string;
};

export const CLIENT_COLUMNS = "id, organization_id, user_id, name, notes, lead_user_id, report_enabled, report_ask, share_token, created_at, updated_at";

export async function loadClientBills(db: Db, clientId: string): Promise<ReportBill[]> {
  const { data } = await db
    .from("client_bills")
    .select("bill_id, position, note, added_at, bills(title, status_stage, bill_type, latest_action, latest_action_date)")
    .eq("client_id", clientId)
    .order("added_at", { ascending: true });
  return ((data as any[]) ?? []).map((r) => {
    const b = Array.isArray(r.bills) ? r.bills[0] : r.bills;
    return {
      billId: r.bill_id,
      title: b?.title ?? r.bill_id,
      stage: b?.status_stage ?? "introduced",
      billType: b?.bill_type ?? r.bill_id.split("-")[0],
      position: r.position,
      note: r.note,
      latestAction: b?.latest_action ?? null,
      latestActionDate: b?.latest_action_date ?? null,
    };
  });
}

export async function firmNameFor(db: Db, client: Pick<ClientRow, "organization_id">): Promise<string> {
  if (!client.organization_id) return "Bill Tracker";
  const { data } = await db.from("organizations").select("name").eq("id", client.organization_id).maybeSingle();
  return data?.name ?? "Bill Tracker";
}

/** Builds this week's report for a client from live data. */
export async function buildReportFor(db: Db, client: ClientRow, now = new Date()): Promise<ClientReport> {
  const bills = await loadClientBills(db, client.id);
  const ids = bills.map((b) => b.billId);
  const weekOf = weekMonday(now);
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  let events: ReportEvent[] = [];
  let meetings: MeetingRow[] = [];
  let floor: FloorItem[] = [];
  if (ids.length) {
    const evq = (cols: string) => db.from("bill_events").select(cols).in("bill_id", ids).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(300);
    let { data: ev, error } = await evq("bill_id, event_type, summary, occurred_at, action_date");
    if (error) ({ data: ev } = await evq("bill_id, event_type, summary, occurred_at"));
    events = ((ev as any[]) ?? []).map((e) => ({ billId: e.bill_id, type: e.event_type, summary: e.summary, date: e.action_date ?? e.occurred_at }));

    const { data: mt } = await db
      .from("committee_meetings")
      .select("event_id, congress, chamber, meeting_at, title, meeting_type, status, committees, location, bill_ids, witness_count, document_count, video_url, source_updated_at")
      .overlaps("bill_ids", ids)
      .gte("meeting_at", new Date(now.getTime() - 3_600_000).toISOString())
      .lt("meeting_at", new Date(now.getTime() + 8 * 86_400_000).toISOString())
      .limit(100);
    meetings = (mt as MeetingRow[]) ?? [];

    const { data: fw } = await db.from("floor_weeks").select("items").eq("week_of", weekOf);
    floor = ((fw as any[]) ?? []).flatMap((w) => (w.items as FloorItem[]) ?? []);
  }

  return buildClientReport({
    clientName: client.name,
    firmName: await firmNameFor(db, client),
    weekOf,
    now,
    bills,
    events,
    meetings,
    floor,
    ask: client.report_ask,
  });
}

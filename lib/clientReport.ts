// The Monday client report: what moved last week on a client's bills,
// what's coming up this week, and what you need from them. Pure (no I/O):
// lib/clientReportData.ts gathers the inputs, this decides what the report
// says, and the same result feeds the preview, the PDF page, the shared
// link and the email. Tested in tests/clientReport.test.ts.

import { citationFor, explainAction, daysSince } from "@/lib/billMeta";
import { STAGE_LABELS, QUIET_DAYS } from "@/lib/billStage";
import { FLOOR_CATEGORY_LABELS, type FloorItem } from "@/lib/houseFloor";
import { isMarkup, dayInWashington, timeInWashington } from "@/lib/weekAhead";
import type { MeetingRow } from "@/lib/meetings";

export const POSITION_LABELS: Record<string, string> = {
  support: "Support",
  oppose: "Oppose",
  watching: "Watching",
  none: "No position",
};

export type ReportBill = {
  billId: string;
  title: string;
  stage: string;
  billType: string;
  position: string;
  note: string | null;
  latestAction: string | null;
  latestActionDate: string | null;
};

export type ReportEvent = { billId: string; type: string; summary: string; date: string };

export type ClientReport = {
  clientName: string;
  firmName: string;
  weekOf: string;
  generatedAt: string;
  moved: { billId: string; citation: string; title: string; stage: string; stageLabel: string; position: string; lines: { date: string; text: string; plain: string | null }[] }[];
  upcoming: { day: string; time: string | null; kind: string; title: string; committees: string[]; citations: string[]; cancelled: boolean }[];
  floor: { citation: string; billId: string | null; title: string; how: string }[];
  quiet: { billId: string; citation: string; title: string; days: number }[];
  portfolio: { billId: string; citation: string; title: string; stage: string; stageLabel: string; billType: string; position: string; positionLabel: string; note: string | null; lastActionDate: string | null }[];
  ask: string | null;
};

const MOVE_TYPES = new Set(["status_change", "new_action", "text_published", "cbo_published"]);
const MAX_LINES_PER_BILL = 3;

export function buildClientReport(input: {
  clientName: string;
  firmName: string;
  weekOf: string;
  now: Date;
  bills: ReportBill[];
  events: ReportEvent[];
  meetings: MeetingRow[];
  floor: FloorItem[];
  ask: string | null;
}): ClientReport {
  const byId = new Map(input.bills.map((b) => [b.billId, b]));

  // What moved: newest first within each bill, status changes before routine actions.
  const grouped = new Map<string, ReportEvent[]>();
  for (const e of input.events) {
    if (!byId.has(e.billId) || !MOVE_TYPES.has(e.type)) continue;
    grouped.set(e.billId, [...(grouped.get(e.billId) ?? []), e]);
  }
  const moved = Array.from(grouped.entries())
    .map(([billId, evs]) => {
      const b = byId.get(billId)!;
      const sorted = [...evs].sort((x, y) => (x.type === "status_change" ? 0 : 1) - (y.type === "status_change" ? 0 : 1) || y.date.localeCompare(x.date));
      const seen = new Set<string>();
      const lines = sorted
        .filter((e) => (seen.has(e.summary) ? false : (seen.add(e.summary), true)))
        .slice(0, MAX_LINES_PER_BILL)
        .map((e) => ({
          date: e.date.slice(0, 10),
          text: e.summary,
          // Stage changes read "Passed House: <action text>"; explain the action part.
          plain: explainAction(e.summary, b.billType) ?? (e.type === "status_change" ? explainAction(e.summary.replace(/^[^:]{0,40}:\s*/, ""), b.billType) : null),
        }));
      return { billId, citation: citationFor(billId), title: b.title, stage: b.stage, stageLabel: STAGE_LABELS[b.stage] ?? b.stage, position: b.position, lines, latest: sorted[0]?.date ?? "" };
    })
    .sort((a, b) => b.latest.localeCompare(a.latest))
    .map(({ latest: _l, ...m }) => m);

  // Coming up: meetings in the next seven days that name one of the client's bills.
  const horizon = input.now.getTime() + 8 * 86_400_000;
  const upcoming = input.meetings
    .filter((m) => m.meeting_at && new Date(m.meeting_at).getTime() >= input.now.getTime() - 3_600_000 && new Date(m.meeting_at).getTime() < horizon)
    .map((m) => ({ m, ids: m.bill_ids.filter((id) => byId.has(id)) }))
    .filter((x) => x.ids.length > 0)
    .sort((a, b) => String(a.m.meeting_at).localeCompare(String(b.m.meeting_at)))
    .map(({ m, ids }) => ({
      day: dayInWashington(m.meeting_at!),
      time: timeInWashington(m.meeting_at!),
      kind: isMarkup(m.meeting_type, m.title) ? "Markup" : (m.meeting_type ?? "").toLowerCase() === "hearing" ? "Hearing" : "Meeting",
      title: m.title ?? "Committee meeting",
      committees: m.committees.map((c) => c.name),
      citations: ids.map((id) => citationFor(id)),
      cancelled: !!m.status && m.status !== "Scheduled",
    }));

  const floor = input.floor
    .filter((f) => f.billId && byId.has(f.billId))
    .map((f) => ({ citation: f.citation, billId: f.billId, title: byId.get(f.billId!)?.title ?? f.title, how: FLOOR_CATEGORY_LABELS[f.category] }));

  const quiet = input.bills
    .map((b) => ({ b, days: daysSince(b.latestActionDate) }))
    .filter((x): x is { b: ReportBill; days: number } => x.days !== null && x.days >= QUIET_DAYS && !grouped.has(x.b.billId))
    .map(({ b, days }) => ({ billId: b.billId, citation: citationFor(b.billId), title: b.title, days }));

  const order: Record<string, number> = { support: 0, oppose: 1, watching: 2, none: 3 };
  const portfolio = [...input.bills]
    .sort((a, b) => (order[a.position] ?? 4) - (order[b.position] ?? 4) || String(b.latestActionDate ?? "").localeCompare(String(a.latestActionDate ?? "")))
    .map((b) => ({
      billId: b.billId,
      citation: citationFor(b.billId),
      title: b.title,
      stage: b.stage,
      stageLabel: STAGE_LABELS[b.stage] ?? b.stage,
      billType: b.billType,
      position: b.position,
      positionLabel: POSITION_LABELS[b.position] ?? b.position,
      note: b.note,
      lastActionDate: b.latestActionDate,
    }));

  return {
    clientName: input.clientName,
    firmName: input.firmName,
    weekOf: input.weekOf,
    generatedAt: input.now.toISOString(),
    moved,
    upcoming,
    floor,
    quiet,
    portfolio,
    ask: input.ask?.trim() ? input.ask.trim() : null,
  };
}

export function weekOfLabel(weekOf: string) {
  return new Date(`${weekOf}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function dayLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

/** One plain sentence for the email preview line and the top of the report. */
export function reportSummary(r: ClientReport): string {
  const parts: string[] = [];
  if (r.moved.length) parts.push(`${r.moved.length} of ${r.portfolio.length} bill${r.portfolio.length === 1 ? "" : "s"} moved last week`);
  else parts.push(`None of the ${r.portfolio.length} bill${r.portfolio.length === 1 ? "" : "s"} moved last week`);
  const markups = r.upcoming.filter((u) => u.kind === "Markup" && !u.cancelled).length;
  const meetings = r.upcoming.filter((u) => !u.cancelled).length;
  if (meetings) parts.push(`${meetings} committee meeting${meetings === 1 ? "" : "s"} this week${markups ? `, including ${markups === 1 ? "a markup" : `${markups} markups`}` : ""}`);
  if (r.floor.length) parts.push(`${r.floor.length} on the House floor schedule`);
  return parts.join("; ") + ".";
}

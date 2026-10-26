import { describe, expect, it } from "vitest";
import { buildClientReport, reportSummary, type ReportBill } from "@/lib/clientReport";
import type { MeetingRow } from "@/lib/meetings";

const bill = (billId: string, title: string, stage: string, position: string, latestActionDate: string, note: string | null = null): ReportBill => ({
  billId, title, stage, billType: billId.split("-")[0], position, note, latestAction: null, latestActionDate,
});

const now = new Date("2026-10-26T10:00:00Z");
const bills = [
  bill("hr-4120-119", "Rural Hospital Stabilization Act", "reported", "support", "2026-10-09", "Our top priority this session."),
  bill("hr-1874-119", "Community Health Center Funding Extension", "passed_house", "support", "2026-10-23"),
  bill("hr-2950-119", "Medicare Site-Neutral Payment Act", "committee", "oppose", "2026-06-01"),
];

const meeting = (id: string, at: string, title: string, billIds: string[], status = "Scheduled"): MeetingRow => ({
  event_id: id, congress: 119, chamber: "Senate", meeting_at: at, title, meeting_type: "Meeting", status,
  committees: [{ name: "Finance Committee", systemCode: null }], location: null, bill_ids: billIds, witness_count: 0, document_count: 0, video_url: null, source_updated_at: null,
});

const report = buildClientReport({
  clientName: "Valley Regional",
  firmName: "Pinnacle Strategies",
  weekOf: "2026-10-26",
  now,
  bills,
  events: [
    { billId: "hr-1874-119", type: "new_action", summary: "Received in the Senate.", date: "2026-10-24" },
    { billId: "hr-1874-119", type: "status_change", summary: "Passed House: On passage Passed by the Yeas and Nays: 388 - 31 (Roll no. 288).", date: "2026-10-23" },
    { billId: "hr-1874-119", type: "cosponsor_change", summary: "2 cosponsors added (now 40)", date: "2026-10-22" },
    { billId: "hr-9999-119", type: "status_change", summary: "Not this client's bill", date: "2026-10-22" },
  ],
  meetings: [
    meeting("1", "2026-10-28T13:30:00Z", "Executive Session", ["hr-4120-119", "s-1-119"]),
    meeting("2", "2026-10-29T14:00:00Z", "Unrelated hearing", ["s-5-119"]),
    meeting("3", "2026-11-20T14:00:00Z", "Too far out", ["hr-4120-119"]),
  ],
  floor: [{ citation: "H.R. 4120", billId: "hr-4120-119", title: "", category: "suspension" }],
  ask: "  Please confirm the coalition letter by Thursday.  ",
});

describe("the Monday client report", () => {
  it("reports only this client's moves, stage changes first, with a plain explanation", () => {
    expect(report.moved).toHaveLength(1);
    expect(report.moved[0].citation).toBe("H.R. 1874");
    expect(report.moved[0].lines.map((l) => l.text)).toEqual([
      "Passed House: On passage Passed by the Yeas and Nays: 388 - 31 (Roll no. 288).",
      "Received in the Senate.",
    ]);
    expect(report.moved[0].lines[0].plain).toMatch(/Senate/);
  });

  it("lists this week's meetings and floor items for the client's bills only", () => {
    expect(report.upcoming).toHaveLength(1);
    expect(report.upcoming[0]).toMatchObject({ day: "2026-10-28", time: "9:30 AM", kind: "Markup", citations: ["H.R. 4120"] });
    expect(report.floor).toEqual([{ citation: "H.R. 4120", billId: "hr-4120-119", title: "Rural Hospital Stabilization Act", how: "Under suspension of the rules (needs two-thirds)" }]);
  });

  it("flags bills that have gone quiet and orders the portfolio by position", () => {
    expect(report.quiet.map((q) => q.citation)).toEqual(["H.R. 2950"]);
    expect(report.portfolio.map((p) => p.positionLabel)).toEqual(["Support", "Support", "Oppose"]);
    expect(report.portfolio[1].note).toBe("Our top priority this session.");
  });

  it("trims the ask and summarises the week in one line", () => {
    expect(report.ask).toBe("Please confirm the coalition letter by Thursday.");
    expect(reportSummary(report)).toBe("1 of 3 bills moved last week; 1 committee meeting this week, including a markup; 1 on the House floor schedule.");
  });
});

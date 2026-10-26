import { describe, expect, it } from "vitest";
import { buildWeek, isMarkup, topicMatches, weekHeadline, reasonsFor, timeInWashington, dayInWashington } from "@/lib/weekAhead";
import type { MeetingRow } from "@/lib/meetings";

const meeting = (id: string, at: string, title: string, bills: string[] = [], extra: Partial<MeetingRow> = {}): MeetingRow => ({
  event_id: id,
  congress: 119,
  chamber: "House",
  meeting_at: at,
  title,
  meeting_type: "Hearing",
  status: "Scheduled",
  committees: [{ name: "Health Subcommittee", systemCode: null }],
  location: null,
  bill_ids: bills,
  witness_count: 0,
  document_count: 0,
  video_url: null,
  source_updated_at: null,
  ...extra,
});

const ctx = {
  tracked: new Set(["hr-4120-119"]),
  suggested: new Set(["hr-3017-119"]),
  topics: ["telehealth", "critical access hospitals"],
  clients: new Map([["s-2231-119", ["Valley Regional"]]]),
};

const meetings = [
  meeting("1", "2026-10-27T14:00:00Z", "Keeping rural hospitals open", ["hr-4120-119"]),
  meeting("2", "2026-10-28T13:30:00Z", "Executive Session", ["s-2231-119"], { chamber: "Senate", meeting_type: "Meeting" }),
  meeting("3", "2026-10-29T14:00:00Z", "Telehealth after the waivers", ["hr-3017-119"]),
  meeting("4", "2026-10-29T18:00:00Z", "Oversight of the Coast Guard"),
  meeting("5", "2026-11-03T14:00:00Z", "Next week, not this one", ["hr-4120-119"]),
];

describe("week ahead", () => {
  const view = buildWeek("2026-10-26", meetings, [{ citation: "H.R. 4120", billId: "hr-4120-119", title: "Rural Hospital Stabilization Act", category: "suspension" }, { citation: "H.R. 1", billId: "hr-1-119", title: "Something else", category: "rule" }], ctx);

  it("keeps only what touches your bills, clients and topics, in Washington time", () => {
    const events = view.days.flatMap((d) => d.events);
    expect(events.map((e) => e.id)).toEqual(["1", "2", "3"]);
    expect(events[0].time).toBe("10:00 AM");
    expect(events[0].day).toBe("2026-10-27");
    expect(view.days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });

  it("says why each one is there", () => {
    const events = view.days.flatMap((d) => d.events);
    expect(reasonsFor(events[0])).toEqual(["You track H.R. 4120"]);
    expect(reasonsFor(events[1])).toEqual(["Valley Regional follows S. 2231"]);
    expect(reasonsFor(events[2])).toEqual(["H.R. 3017 is a suggestion", "Matches your topic: telehealth"]);
  });

  it("spots Senate markups, which congress.gov calls meetings", () => {
    expect(view.days.flatMap((d) => d.events)[1].kind).toBe("Markup");
    expect(isMarkup("Meeting", "Business Meeting to consider S. 2231")).toBe(true);
    expect(isMarkup("Hearing", "Hearing on markets")).toBe(false);
  });

  it("groups several bills into one reason", () => {
    expect(reasonsFor({ relevance: [{ kind: "tracked", billId: "s-1260-119" }, { kind: "tracked", billId: "s-2016-119" }, { kind: "client", billId: "s-1260-119", client: "Valley" }] })).toEqual([
      "You track S. 1260 and S. 2016",
      "Valley follows S. 1260",
    ]);
  });

  it("doesn't count cancelled or postponed meetings in the headline", () => {
    const v = buildWeek("2026-10-26", [meetings[0], { ...meetings[1], status: "Postponed" }], [], ctx);
    expect(v.counts).toEqual({ meetings: 1, markups: 0, floor: 0 });
    expect(v.days.flatMap((d) => d.events)).toHaveLength(2);
  });

  it("shows everything when asked, with your items first", () => {
    const all = buildWeek("2026-10-26", meetings, [], ctx, "all");
    const thursday = all.days.find((d) => d.day === "2026-10-29")!;
    expect(thursday.events.map((e) => e.id)).toEqual(["3", "4"]);
    expect(all.counts.meetings).toBe(3);
  });

  it("lists your floor items and writes a plain headline", () => {
    expect(view.floor.map((f) => f.citation)).toEqual(["H.R. 4120"]);
    expect(weekHeadline(view)).toBe("3 committee meetings touch your bills or topics, and 1 of your bills is on the House floor schedule. One is a markup, where a bill can be voted out of committee.");
  });

  it("matches topics on whole meaning words, not stray letters", () => {
    expect(topicMatches("critical access hospitals", "Critical Access Hospital payment rules")).toBe(true);
    expect(topicMatches("VA", "Evaluating avalanche safety")).toBe(false);
    expect(topicMatches("340B", "The 340B drug pricing program")).toBe(true);
  });

  it("treats a missing time as unannounced, not midnight", () => {
    expect(timeInWashington("2026-10-27T04:00:00Z")).toBeNull();
    expect(dayInWashington("2026-10-27T03:00:00Z")).toBe("2026-10-26");
  });
});

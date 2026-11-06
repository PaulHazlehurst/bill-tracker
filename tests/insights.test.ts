import { describe, expect, it } from "vitest";
import { buildInsights, headline, momentumFor, stanceFor, weekStart, weeklyActivity } from "@/lib/insights";

const day = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

describe("where you stand", () => {
  it("one position per bill, even with a team", () => {
    expect(stanceFor(["support"])).toBe("support");
    expect(stanceFor(["support", "none"])).toBe("support");
    expect(stanceFor(["support", "watching"])).toBe("support");
    expect(stanceFor(["watching", null])).toBe("watching");
    expect(stanceFor(["none", "none"])).toBe("none");
    expect(stanceFor(["support", "oppose"])).toBe("split");
    expect(stanceFor(["support", "oppose", "watching"])).toBe("split");
  });

  it("momentum from the stage and the last action", () => {
    expect(momentumFor("enacted", null)).toBe("law");
    expect(momentumFor("agreed", null)).toBe("law");
    expect(momentumFor("vetoed", day(1))).toBe("stopped");
    expect(momentumFor("committee", day(3))).toBe("moving");
    expect(momentumFor("committee", day(45))).toBe("slowing");
    expect(momentumFor("committee", day(200))).toBe("quiet");
    expect(momentumFor("introduced", null)).toBe("quiet");
    // The 119th Congress ends January 3, 2027: what didn't pass by then has died.
    expect(momentumFor("passed_house", day(3), "hr-2407-119", new Date("2026-12-28T12:00:00Z"))).toBe("moving");
    expect(momentumFor("passed_house", "2026-12-20", "hr-2407-119", new Date("2027-01-10T12:00:00Z"))).toBe("stopped");
    expect(momentumFor("enacted", "2026-12-20", "hr-2407-119", new Date("2027-01-10T12:00:00Z"))).toBe("law");
  });
});

describe("weekly activity", () => {
  it("counts actions per week, Monday to Sunday", () => {
    expect(weekStart(new Date(2026, 10, 6))).toBe("2026-11-02"); // a Friday
    expect(weekStart(new Date(2026, 10, 2))).toBe("2026-11-02"); // the Monday
    expect(weekStart(new Date(2026, 10, 1))).toBe("2026-10-26"); // the Sunday before
    const now = new Date(2026, 10, 6, 12);
    const weeks = weeklyActivity(
      [
        { bill_id: "a", occurred_at: "2026-11-03T15:00:00Z", event_type: "status_change" },
        { bill_id: "a", occurred_at: "2026-11-04T15:00:00Z", event_type: "new_action" },
        { bill_id: "a", occurred_at: "2026-10-28T15:00:00Z", event_type: "new_action" },
        { bill_id: "a", occurred_at: "2025-01-01T15:00:00Z", event_type: "new_action" },
      ],
      12,
      now,
    );
    expect(weeks).toHaveLength(12);
    expect(weeks[11]).toEqual({ start: "2026-11-02", actions: 2, stageChanges: 1 });
    expect(weeks[10]).toEqual({ start: "2026-10-26", actions: 1, stageChanges: 0 });
    expect(weeks[0].start).toBe("2026-08-17");
  });
});

describe("the page", () => {
  const bills = [
    { id: "hr-1-119", title: "Threat Act", status_stage: "passed_house", latest_action: "Passed", latest_action_date: day(2), cosponsor_breakdown: { D: 2, R: 30, I: 0 } },
    { id: "s-2-119", title: "Ally Act", status_stage: "passed_senate", latest_action: "Passed", latest_action_date: day(10), cosponsor_breakdown: { D: 12, R: 10, I: 1 } },
    { id: "hr-3-119", title: "Stuck Act", status_stage: "committee", latest_action: "Referred", latest_action_date: day(120) },
    { id: "hr-4-119", title: "Won Act", status_stage: "enacted", latest_action: "Became law", latest_action_date: day(300) },
    { id: "hr-5-119", title: "Unknown Act", status_stage: "introduced", latest_action: "Introduced", latest_action_date: day(5) },
    { id: "hr-6-119", title: "Argued Act", status_stage: "committee", latest_action: "Hearing", latest_action_date: day(5) },
    { id: "hr-9-119", title: "Not followed", status_stage: "committee", latest_action: null, latest_action_date: day(1) },
  ];
  const trackers = [
    { bill_id: "hr-1-119", position: "oppose" },
    { bill_id: "s-2-119", position: "support" },
    { bill_id: "hr-3-119", position: "support" },
    { bill_id: "hr-4-119", position: "support" },
    { bill_id: "hr-5-119", position: "none" },
    { bill_id: "hr-6-119", position: "support" },
    { bill_id: "hr-6-119", position: "oppose" },
  ];
  const i = buildInsights({
    trackers,
    bills,
    events: [],
    clients: [
      { client_id: "c1", client_name: "Garrett County Hospital", bill_id: "hr-1-119", position: "oppose" },
      { client_id: "c1", client_name: "Garrett County Hospital", bill_id: "s-2-119", position: "support" },
      { client_id: "c2", client_name: "Allegany Health", bill_id: "hr-1-119", position: "support" },
    ],
  });

  it("puts each followed bill in one cell of the grid", () => {
    expect(i.total).toBe(6);
    expect(i.grid.oppose.moving.map((b) => b.citation)).toEqual(["H.R. 1"]);
    expect(i.grid.support.moving.map((b) => b.id)).toEqual(["s-2-119"]);
    expect(i.grid.support.quiet.map((b) => b.id)).toEqual(["hr-3-119"]);
    expect(i.grid.support.law.map((b) => b.id)).toEqual(["hr-4-119"]);
    expect(i.grid.split.moving.map((b) => b.id)).toEqual(["hr-6-119"]);
    expect(i.stancesInUse).toEqual(["support", "oppose", "none", "split"]);
  });

  it("lists what needs attention", () => {
    expect(i.attention.threats.map((b) => b.id)).toEqual(["hr-1-119"]);
    expect(i.attention.closeToFinish.map((b) => b.id)).toEqual(["s-2-119"]);
    expect(i.attention.stuck.map((b) => b.id)).toEqual(["hr-3-119"]);
    expect(i.attention.split.map((b) => b.id)).toEqual(["hr-6-119"]);
    expect(i.attention.noPosition).toBe(1);
    expect(headline(i)).toEqual({
      lead: "6 bills followed; 4 moved in the last 30 days.",
      detail: ["1 you oppose is moving.", "1 you support has cleared a chamber.", "1 you support has stalled."],
    });
  });

  it("flags lopsided and bipartisan cosponsor lists", () => {
    expect(i.cosponsorBalance.map((b) => [b.id, b.bipartisan])).toEqual([["hr-1-119", false], ["s-2-119", true]]);
  });

  it("judges threats by the position taken for each client", () => {
    expect(i.clients).toEqual([
      expect.objectContaining({ name: "Garrett County Hospital", bills: 2, moving: 2, threats: 1 }),
      expect.objectContaining({ name: "Allegany Health", bills: 1, moving: 1, threats: 0 }),
    ]);
  });
});

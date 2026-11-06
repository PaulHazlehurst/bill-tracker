import { describe, expect, it } from "vitest";
import { daysBetween, deadlineNotifications, regulationsGovUrl, sectionFor, sortForSection, whenText } from "@/lib/regulations";

describe("dates", () => {
  it("counts whole days and says them plainly", () => {
    expect(daysBetween("2026-11-06", "2026-11-21")).toBe(15);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // across the clock change
    expect(whenText(0)).toBe("today");
    expect(whenText(1)).toBe("tomorrow");
    expect(whenText(9)).toBe("in 9 days");
  });
});

describe("where to comment", () => {
  it("links regulations.gov dockets and skips agencies' own numbering", () => {
    expect(regulationsGovUrl("CMS-2026-0142")).toBe("https://www.regulations.gov/docket/CMS-2026-0142");
    expect(regulationsGovUrl("Docket No. FDA-2026-N-1234")).toBe("https://www.regulations.gov/docket/FDA-2026-N-1234");
    expect(regulationsGovUrl("hrsa-2026-0007; CMS-1")).toBe("https://www.regulations.gov/docket/HRSA-2026-0007");
    expect(regulationsGovUrl("RIN 0938-AV12")).toBeNull();
    expect(regulationsGovUrl("FR Doc. 2026-12345")).toBeNull();
    expect(regulationsGovUrl(null)).toBeNull();
  });
});

describe("sections", () => {
  const today = "2026-11-06";
  it("sorts each regulation into one section", () => {
    expect(sectionFor({ doc_type: "proposed", comment_close_date: "2026-11-06" }, today)).toBe("open");
    expect(sectionFor({ doc_type: "notice", comment_close_date: "2026-12-01" }, today)).toBe("open");
    expect(sectionFor({ doc_type: "final", comment_close_date: null }, today)).toBe("final");
    expect(sectionFor({ doc_type: "proposed", comment_close_date: "2026-10-01" }, today)).toBe("other");
  });

  it("puts upcoming effective dates first, then the newest already in effect", () => {
    const r = (id: string, effective_date: string | null, publication_date = "2026-09-01") => ({ id, reg: { comment_close_date: null, effective_date, publication_date } });
    const out = sortForSection([r("old", "2026-01-01"), r("soon", "2026-11-20"), r("later", "2027-01-01"), r("recent", "2026-10-01")], "final", today);
    expect(out.map((x) => x.id)).toEqual(["soon", "later", "recent", "old"]);
  });
});

describe("deadline reminders", () => {
  const row = (over: object) => ({ regulation_id: "2026-1", organization_id: "org", user_id: null, status: "following", title: "Rural Health Clinic payment changes", comment_close_date: "2026-11-13", ...over });
  const team = () => ["u1", "u2"];

  it("reminds the whole team a week out and the day before", () => {
    const week = deadlineNotifications([row({})], team, "2026-11-06");
    expect(week).toHaveLength(2);
    expect(week[0]).toMatchObject({ userId: "u1", kind: "regulation", title: "Comments close in 7 days", dedupeKey: "reg:2026-1:week", url: "/regulations?focus=2026-1" });
    expect(deadlineNotifications([row({})], team, "2026-11-12")[0]).toMatchObject({ title: "Comments close tomorrow", dedupeKey: "reg:2026-1:last" });
    expect(deadlineNotifications([row({ status: "commenting" })], team, "2026-11-13")[0].body).toMatch(/writing a comment/);
  });

  it("stays quiet when there's nothing to do", () => {
    expect(deadlineNotifications([row({})], team, "2026-11-05")).toEqual([]); // 8 days out
    expect(deadlineNotifications([row({ status: "commented" })], team, "2026-11-12")).toEqual([]);
    expect(deadlineNotifications([row({ status: "new" })], team, "2026-11-12")).toEqual([]);
    expect(deadlineNotifications([row({ organization_id: null, user_id: "solo" })], team, "2026-11-12").map((n) => n.userId)).toEqual(["solo"]);
  });
});

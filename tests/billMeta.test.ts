import { describe, expect, it } from "vitest";
import { parseDay, parseVoteInfo, billIdFromCitation, congressForDate, citationFor, publicBillUrl } from "@/lib/billMeta";

describe("bill helpers", () => {
  it("reads bare dates as calendar days, not the previous evening", () => {
    const d = parseDay("2026-10-14");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 14]);
  });

  it("reads House and Senate vote tallies", () => {
    expect(parseVoteInfo("On passage Passed by the Yeas and Nays: 388 - 31 (Roll no. 288).")).toMatchObject({ yea: 388, nay: 31, rollNumber: "288", passed: true });
    expect(parseVoteInfo("Passed Senate without amendment by Yea-Nay Vote. 79 - 19. Record Vote Number: 71.")).toMatchObject({ yea: 79, nay: 19, rollNumber: "71" });
    expect(parseVoteInfo("Referred to H.R. 1234 - 5")).toBeNull();
  });

  it("turns citations into bill ids", () => {
    expect(billIdFromCitation("H.R. 4120", 119)).toBe("hr-4120-119");
    expect(billIdFromCitation("S. 283", 119)).toBe("s-283-119");
    expect(billIdFromCitation("H.Con.Res. 12", 119)).toBe("hconres-12-119");
    expect(billIdFromCitation("Amendment 5", 119)).toBeNull();
    expect(citationFor("hjres-7-119")).toBe("H.J.Res. 7");
    expect(publicBillUrl("s-283-119")).toBe("https://www.congress.gov/bill/119th-congress/senate-bill/283");
  });

  it("knows which Congress is in session", () => {
    expect(congressForDate(new Date("2026-10-26T12:00:00Z"))).toBe(119);
    expect(congressForDate(new Date("2027-01-02T12:00:00Z"))).toBe(119);
    expect(congressForDate(new Date("2027-01-03T12:00:00Z"))).toBe(120);
  });
});

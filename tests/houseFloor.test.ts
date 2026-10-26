import { describe, expect, it } from "vitest";
import { parseFloorXml, weekMonday, addDays, floorScheduleUrl } from "@/lib/houseFloor";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<floorschedule update-date="2026-10-23T17:12:00" week-date="2026-10-26">
  <category type="suspension">
    <floor-items>
      <floor-item id="1" add-date="2026-10-23T17:00:00" remove-date="" publish-date="2026-10-23T17:00:00">
        <legis-num>H.R. 3388</legis-num>
        <floor-text>Rural EMS Access Act, as amended</floor-text>
      </floor-item>
      <floor-item id="2" add-date="2026-10-23T17:00:00" remove-date="2026-10-24T10:00:00">
        <legis-num>H.R. 999</legis-num>
        <floor-text>Pulled from the schedule</floor-text>
      </floor-item>
      <floor-item id="3"><legis-num>S. 283</legis-num><floor-text>Illegal Red Snapper &amp; Tuna Enforcement Act</floor-text></floor-item>
    </floor-items>
  </category>
  <category type="rule">
    <floor-items>
      <floor-item id="4"><legis-num>H.R. 1874</legis-num><floor-text>Providing for congressional disapproval of the rule submitted by CMS</floor-text></floor-item>
    </floor-items>
  </category>
</floorschedule>`;

describe("House floor schedule", () => {
  it("reads bills, their category, and skips items taken off the list", () => {
    const items = parseFloorXml(XML, 119);
    expect(items).toEqual([
      { citation: "H.R. 3388", billId: "hr-3388-119", title: "Rural EMS Access Act, as amended", category: "suspension" },
      { citation: "S. 283", billId: "s-283-119", title: "Illegal Red Snapper & Tuna Enforcement Act", category: "suspension" },
      { citation: "H.R. 1874", billId: "hr-1874-119", title: "Providing for congressional disapproval of the rule submitted by CMS", category: "rule" },
    ]);
  });

  it("still finds bill numbers if the file's layout changes", () => {
    expect(parseFloorXml("<schedule><item><legis-num>H.R. 12</legis-num></item></schedule>", 119).map((i) => i.billId)).toEqual(["hr-12-119"]);
    expect(parseFloorXml("<schedule><p>Consideration of H.R. 45 and S. 9</p></schedule>", 119).map((i) => i.billId)).toEqual(["hr-45-119", "s-9-119"]);
  });

  it("works out the week in Washington time", () => {
    // Sunday 11pm in Washington is already Monday in UTC; it still belongs to the earlier week.
    expect(weekMonday(new Date("2026-11-02T03:30:00Z"))).toBe("2026-10-26");
    expect(weekMonday(new Date("2026-10-28T15:00:00Z"))).toBe("2026-10-26");
    expect(weekMonday(new Date("2026-11-02T15:00:00Z"))).toBe("2026-11-02");
    expect(addDays("2026-10-26", 7)).toBe("2026-11-02");
    expect(floorScheduleUrl("2026-10-26")).toBe("https://docs.house.gov/floor/Download.aspx?file=/billsthisweek/20261026/20261026.xml");
  });
});

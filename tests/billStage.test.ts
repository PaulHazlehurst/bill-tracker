import { describe, expect, it } from "vitest";
import { journeyFromActions, mergeStage, inferStageFromText, routeStations, stageRank } from "@/lib/billStage";

const a = (actionDate: string, text: string, extra: Record<string, string> = {}) => ({ actionDate, text, ...extra });

describe("bill stage from full action history", () => {
  it("stays Passed House when the Senate later refers it to committee", () => {
    const j = journeyFromActions(
      [
        a("2026-03-04", "Introduced in House"),
        a("2026-03-04", "Referred to the Committee on Energy and Commerce."),
        a("2026-06-10", "Passed/agreed to in House: On passage Passed by recorded vote: 300 - 120 (Roll no. 210)."),
        a("2026-06-11", "Received in the Senate and Read twice and referred to the Committee on Finance."),
      ],
      "hr",
    );
    expect(j.stage).toBe("passed_house");
    expect(j.passedHouse?.date).toBe("2026-06-10");
  });

  it("treats Union Calendar placement and ordered-reported as Reported, not Introduced", () => {
    expect(journeyFromActions([a("2026-03-04", "Introduced in House"), a("2026-05-01", "Placed on the Union Calendar, Calendar No. 412.")], "hr").stage).toBe("reported");
    expect(journeyFromActions([a("2026-03-04", "Introduced in House"), a("2026-04-20", "Ordered to be Reported by Voice Vote.")], "hr").stage).toBe("reported");
  });

  it("orders a Senate bill Senate first and only calls it both chambers when the House passes it too", () => {
    const senateOnly = journeyFromActions([a("2026-02-01", "Introduced in Senate"), a("2026-04-01", "Passed Senate without amendment by Unanimous Consent.")], "s");
    expect(senateOnly.stage).toBe("passed_senate");
    const both = journeyFromActions([...[a("2026-02-01", "Introduced in Senate"), a("2026-04-01", "Passed Senate without amendment by Unanimous Consent.")], a("2026-07-01", "On passage Passed without objection.", { actionCode: "8000" })], "s");
    expect(both.stage).toBe("passed_both");
    expect(routeStations("passed_senate", "s").map((s) => s.label)).toEqual(["Introduced", "Committee", "Senate", "House", "President", "Law"]);
  });

  it("marks law and agreed-to resolutions as finished", () => {
    expect(journeyFromActions([a("2026-01-01", "Introduced in House"), a("2026-09-01", "Became Public Law No: 119-55.")], "hr").stage).toBe("enacted");
    expect(journeyFromActions([a("2026-01-01", "Submitted in the Senate."), a("2026-01-05", "Resolution agreed to in Senate without amendment.")], "sres").stage).toBe("agreed");
  });

  it("never lets a one-line guess move a bill backwards", () => {
    expect(mergeStage("passed_house", inferStageFromText("Referred to the Committee on Finance.", "hr"))).toBe("passed_house");
    expect(mergeStage("committee", "reported")).toBe("reported");
    expect(stageRank("enacted")).toBeGreaterThan(stageRank("to_president"));
  });
});

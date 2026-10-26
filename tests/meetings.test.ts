import { describe, expect, it } from "vitest";
import { normalizeMeeting, parseApiDate, meetingPageUrl } from "@/lib/meetings";

// Shaped like congress.gov's committee-meeting detail record.
const DETAIL = {
  eventId: "118421",
  congress: 119,
  chamber: "House",
  date: "2026-10-27T14:00:00Z",
  updateDate: "2026-10-22T19:04:11Z",
  title: "  Keeping Rural Hospitals Open ",
  type: "Hearing",
  meetingStatus: "Scheduled",
  committees: [{ name: "Energy and Commerce Committee", systemCode: "hsif00" }, { name: "Health Subcommittee", systemCode: "hsif14" }],
  location: { building: "Rayburn House Office Building", room: "2123" },
  relatedItems: { bills: [{ type: "HR", number: "4120", congress: 119 }, { type: "S", number: 2231, congress: 119 }] },
  witnesses: [{ name: "A. Witness" }, { name: "B. Witness" }],
  meetingDocuments: [{ name: "Hearing notice" }],
  witnessDocuments: [{ documentType: "Witness Statement" }],
  videos: [{ name: "Hearing", url: "https://www.congress.gov/committees/video/house-energy-and-commerce/hsif00/abc" }],
};

describe("committee meetings", () => {
  it("turns a congress.gov record into a row", () => {
    expect(normalizeMeeting(DETAIL)).toEqual({
      event_id: "118421",
      congress: 119,
      chamber: "House",
      meeting_at: "2026-10-27T14:00:00.000Z",
      title: "Keeping Rural Hospitals Open",
      meeting_type: "Hearing",
      status: "Scheduled",
      committees: [{ name: "Energy and Commerce Committee", systemCode: "hsif00" }, { name: "Health Subcommittee", systemCode: "hsif14" }],
      location: "Rayburn House Office Building, Room 2123",
      bill_ids: ["hr-4120-119", "s-2231-119"],
      witness_count: 2,
      document_count: 2,
      video_url: "https://www.congress.gov/committees/video/house-energy-and-commerce/hsif00/abc",
      source_updated_at: "2026-10-22T19:04:11.000Z",
    });
  });

  it("handles the XML-style single item shape and online meetings", () => {
    const row = normalizeMeeting({ ...DETAIL, relatedItems: { bills: { item: { type: "hres", number: "12", congress: 119 } } }, location: { room: "WEBEX" }, committees: { item: { name: "Rules Committee" } } });
    expect(row?.bill_ids).toEqual(["hres-12-119"]);
    expect(row?.location).toBe("Online");
    expect(row?.committees).toEqual([{ name: "Rules Committee", systemCode: null }]);
  });

  it("reads both date formats congress.gov uses", () => {
    expect(parseApiDate("2026-10-22 19:04:11+00:00")).toBe("2026-10-22T19:04:11.000Z");
    expect(parseApiDate("2026-10-22T19:04:11Z")).toBe("2026-10-22T19:04:11.000Z");
    expect(parseApiDate("")).toBeNull();
    expect(parseApiDate("not a date")).toBeNull();
  });

  it("links to the meeting on congress.gov", () => {
    expect(meetingPageUrl({ event_id: "118421", congress: 119, chamber: "Senate" })).toBe("https://www.congress.gov/event/119th-congress/senate-event/118421");
    expect(meetingPageUrl({ event_id: "1", congress: 112, chamber: "House" })).toBe("https://www.congress.gov/event/112th-congress/house-event/1");
  });
});

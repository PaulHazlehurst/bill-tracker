import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, foldLine } from "@/lib/ics";

describe("calendar feed", () => {
  const ics = buildIcs(
    [
      { uid: "meeting-1@billtracker", title: "Hearing: Keeping rural hospitals open; part 2, with witnesses", start: "2026-10-27T14:00:00Z", durationMinutes: 90, location: "Rayburn, Room 2123", description: "Health Subcommittee\nBills: H.R. 4120", url: "https://www.congress.gov/event/119th-congress/house-event/1" },
      { uid: "deadline-1@billtracker", title: "Comments close: 340B guidance", allDay: "2026-10-30" },
      { uid: "meeting-2@billtracker", title: "Markup", start: "2026-10-28T13:30:00Z", cancelled: true },
    ],
    { name: "Bill Tracker: your week", now: new Date("2026-10-26T12:00:00Z") },
  );
  const lines = ics.split("\r\n");

  it("uses CRLF line endings and folds every line to 75 octets", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.includes("\n") && !ics.replace(/\r\n/g, "").includes("\n")).toBe(true);
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("writes timed, all-day and cancelled events", () => {
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DTSTART:20261027T140000Z\r\nDURATION:PT90M");
    expect(unfolded).toContain("SUMMARY:Hearing: Keeping rural hospitals open\\; part 2\\, with witnesses");
    expect(unfolded).toContain("DESCRIPTION:Health Subcommittee\\nBills: H.R. 4120");
    expect(unfolded).toContain("DTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261031");
    expect(unfolded).toContain("STATUS:CANCELLED");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(3);
  });

  it("escapes and folds safely, including multi-byte characters", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldLine(`DESCRIPTION:${"é".repeat(60)}`);
    for (const l of folded.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${"é".repeat(60)}`);
  });
});

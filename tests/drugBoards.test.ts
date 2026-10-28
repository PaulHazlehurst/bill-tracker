import { describe, expect, it } from "vitest";
import {
  extractDocuments, parseDocDate, docKind, normalizeOpenStatesBill, isAboutDrugBoards, drugTrackPosition,
  cleanDrugInput, describeDrugChanges, isPublicWebUrl, STATE_TILES, STATE_NAMES,
} from "@/lib/drugBoards";

const PAGE = `
<nav><a href="/">Home</a><a href="/public-meetings">Public Meetings</a><a href="mailto:pdab@maryland.gov">Email</a></nav>
<main>
  <h2>2026 Board Meetings</h2>
  <ul>
    <li><a href="/Documents/meetings/2026/2026.3.23%20Board%20Meeting%20Agenda%20%283%29.pdf">March 23 Agenda</a></li>
    <li><a href="Documents/meetings/2026/May%2018%2c%202026/2026.5.18%20Board%20Meeting%20Agenda.pdf" title="Agenda">Download</a></li>
    <li><a href='https://mn.gov/commerce-stat/insurance/pdab/11-10-2026/board_agenda_11-10-2026.pdf'>Board agenda</a></li>
    <li><a href="/pdab/Documents/20261021-PDAB-document-package.pdf#page=2">Agenda materials</a></li>
    <li><a href="/cost-reviews/report-jardiance">Jardiance cost review report</a></li>
    <li><a href="https://www.youtube.com/watch?v=abc">Watch the recording</a></li>
    <li><a href="/Documents/meetings/2026/2026.3.23%20Board%20Meeting%20Agenda%20%283%29.pdf">duplicate</a></li>
  </ul>
</main>`;

describe("finding documents on a board page", () => {
  const docs = extractDocuments(PAGE, "https://pdab.prod.maryland.gov/public-meetings");

  it("keeps files and same-site document links, once each, as full addresses", () => {
    expect(docs.map((d) => d.url)).toEqual([
      "https://pdab.prod.maryland.gov/Documents/meetings/2026/2026.3.23%20Board%20Meeting%20Agenda%20%283%29.pdf",
      "https://pdab.prod.maryland.gov/Documents/meetings/2026/May%2018%2c%202026/2026.5.18%20Board%20Meeting%20Agenda.pdf",
      "https://mn.gov/commerce-stat/insurance/pdab/11-10-2026/board_agenda_11-10-2026.pdf",
      "https://pdab.prod.maryland.gov/pdab/Documents/20261021-PDAB-document-package.pdf",
      "https://pdab.prod.maryland.gov/cost-reviews/report-jardiance",
    ]);
  });

  it("uses the link text, or the file name when the text says nothing", () => {
    expect(docs[0].title).toBe("March 23 Agenda");
    expect(docs[1].title).toBe("2026.5.18 Board Meeting Agenda");
  });

  it("reads dates in every format boards use", () => {
    expect(parseDocDate(docs[0].url)).toBe("2026-03-23");
    expect(parseDocDate("May 18, 2026 Board Meeting")).toBe("2026-05-18");
    expect(parseDocDate("board_agenda_11-10-2026.pdf")).toBe("2026-11-10");
    expect(parseDocDate("20261021-PDAB-document-package.pdf")).toBe("2026-10-21");
    expect(parseDocDate("MPDAB _Agenda_01.29.2024_Final.pdf")).toBe("2024-01-29");
    expect(parseDocDate("pdab-meeting-transcript-march-18-2026.pdf")).toBe("2026-03-18");
    expect(parseDocDate("Sept. 9, 2026 notice")).toBe("2026-09-09");
    expect(parseDocDate("HB 1234 report")).toBeNull();
    expect(parseDocDate("2026.13.45 agenda")).toBeNull();
  });

  it("sorts documents into kinds", () => {
    expect(docKind("Board Meeting Agenda")).toBe("agenda");
    expect(docKind("approved minutes")).toBe("minutes");
    expect(docKind("PDAB document package")).toBe("materials");
    expect(docKind("Jardiance cost review report")).toBe("report");
    expect(docKind("Something")).toBe("other");
  });
});

describe("state bills from Open States", () => {
  it("turns a bill record into a row", () => {
    expect(
      normalizeOpenStatesBill({
        id: "ocd-bill/1234",
        identifier: "HB 25-1234",
        title: "  Prescription Drug Affordability Board  Changes ",
        session: "2025A",
        jurisdiction: { id: "ocd-jurisdiction/country:us/state:co/government", name: "Colorado" },
        latest_action_date: "2025-05-01T00:00:00",
        latest_action_description: "Governor Signed",
        openstates_url: "https://openstates.org/co/bills/2025A/HB25-1234/",
      }),
    ).toEqual({ id: "ocd-bill/1234", state: "CO", session: "2025A", identifier: "HB 25-1234", title: "Prescription Drug Affordability Board Changes", latest_action: "Governor Signed", latest_action_date: "2025-05-01", url: "https://openstates.org/co/bills/2025A/HB25-1234/" });
    expect(normalizeOpenStatesBill({ id: "x", identifier: "HB 1", title: "t", jurisdiction: { id: "ocd-jurisdiction/country:us/government" } })).toBeNull();
  });

  it("tells bills about the boards from bills that only mention them", () => {
    expect(isAboutDrugBoards("Concerning the prescription drug affordability review board")).toBe(true);
    expect(isAboutDrugBoards("Establishing upper payment limits for prescription drugs")).toBe(true);
    expect(isAboutDrugBoards("Making appropriations for the fiscal year")).toBe(false);
  });
});

describe("drug tracker", () => {
  it("cleans input and refuses bad values", () => {
    expect(cleanDrugInput({ state: "md", drug: " Ozempic ", price_limit: "", stage: "limit_set", hacker: "x" })).toEqual({ fields: { state: "MD", drug: "Ozempic", price_limit: null, stage: "limit_set" } });
    expect(cleanDrugInput({ stage: "approved" }).error).toBe("Unknown stage.");
    expect(cleanDrugInput({ next_date: "11/16/2026" }).error).toMatch(/Dates/);
    expect(cleanDrugInput({ source_url: "javascript:alert(1)" }).error).toMatch(/web address/);
  });

  it("describes what changed in plain words for the history", () => {
    expect(describeDrugChanges({ stage: "under_review", price_limit: null, notes: null, needs_check: true }, { stage: "limit_set", price_limit: "$600 per dose", notes: "x", needs_check: false })).toEqual([
      "Stage: Under review → Limit set",
      "Price limit: blank → $600 per dose",
      "Notes added",
      "Checked against the source",
    ]);
    expect(describeDrugChanges({ stage: "selected" }, { stage: "selected" })).toEqual([]);
  });

  it("places each stage on the track", () => {
    expect(drugTrackPosition("limit_set")).toEqual({ reached: 4, stopped: false, finished: true });
    expect(drugTrackPosition("limit_blocked")).toEqual({ reached: 4, stopped: true, finished: false });
    expect(drugTrackPosition("under_review").reached).toBe(1);
  });

  it("has one map square per state plus DC, none overlapping", () => {
    expect(STATE_TILES).toHaveLength(51);
    expect(new Set(STATE_TILES.map(([, x, y]) => `${x},${y}`)).size).toBe(51);
    for (const [abbr] of STATE_TILES) expect(STATE_NAMES[abbr], abbr).toBeTruthy();
  });
});

describe("which pages can be watched", () => {
  it("allows public https sites only", () => {
    expect(isPublicWebUrl("https://dfr.oregon.gov/pdab/Pages/board-calendar.aspx")).toBe(true);
    for (const bad of ["http://dfr.oregon.gov/pdab", "https://169.254.169.254/latest/meta-data", "https://localhost/x", "https://[::1]/", "https://intranet/x", "https://db.internal/x", "https://user:pw@example.gov/", "https://example.gov:8443/", "ftp://example.gov/", "not a url"]) {
      expect(isPublicWebUrl(bad), bad).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  pageText, textHash, pageChange, findMentions, drugTerms, findDates, findEventDates, matchMedicarePrice, formatUsd, checkAge,
  parseCourtListenerUrl, normalizeDocketEntry, type MedicarePrice,
} from "@/lib/boardReading";

const PRICES: MedicarePrice[] = [
  { id: "semaglutide-2027", brand_names: ["Ozempic", "Wegovy", "Rybelsus"], generic_name: "semaglutide", price_30_day: 274, list_price_30_day: 959, list_price_year: 2024, effective_year: 2027, source_url: "https://cms.gov/x" },
  { id: "enbrel-2026", brand_names: ["Enbrel"], generic_name: "etanercept", price_30_day: 2355, list_price_30_day: 7106, list_price_year: 2023, effective_year: 2026, source_url: "https://cms.gov/y" },
  { id: "farxiga-2026", brand_names: ["Farxiga"], generic_name: "dapagliflozin", price_30_day: "178.50", list_price_30_day: 556, list_price_year: 2023, effective_year: 2026, source_url: "https://cms.gov/z" },
];

describe("page wording", () => {
  const html = (status: string) => `<html><head><title>UPL</title><script>var t = Date.now()</script></head><body>
    <header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
    <main><h1>Upper Payment Limits</h1><p>${status}</p><p>Page last updated October 1, 2026</p></main>
    <footer>© 2026 State of Maryland</footer></body></html>`;

  it("reads just the main content", () => {
    expect(pageText(html("There are currently no drugs with an active UPL."))).toBe("Upper Payment Limits There are currently no drugs with an active UPL. Page last updated October 1, 2026");
    expect(pageText("<body><nav>Menu</nav><p>Hello&nbsp;there &amp; welcome</p><footer>x</footer></body>")).toBe("Hello there & welcome");
  });

  it("reports a real change of wording as a redline", () => {
    const before = pageText(html("There are currently no drugs with an active UPL."));
    const after = pageText(html("The UPL for Jardiance is active as of January 1, 2027."));
    const change = pageChange(before, after)!;
    expect(change.added).toBeGreaterThan(0);
    expect(change.ops!.some((op) => op.t === "ins" && op.s.includes("Jardiance"))).toBe(true);
    expect(textHash(before)).not.toBe(textHash(after));
  });

  it("ignores a ticking date and links already reported as new documents", () => {
    const base = "Board meetings 2026 agendas and minutes are posted below. Page last updated October 1, 2026";
    expect(pageChange(base, base.replace("October 1", "October 9"))).toBeNull();
    expect(pageChange(base, base.replace("posted below.", "posted below. November 16 Board Meeting Agenda"), ["November 16 Board Meeting Agenda"])).toBeNull();
    expect(pageChange(base, base)).toBeNull();
  });

  it("still catches a one-word change that flips the meaning", () => {
    const a = "There are currently no drugs with an active upper payment limit.";
    expect(pageChange(a, a.replace("no drugs", "two drugs"))).not.toBeNull();
  });
});

describe("drugs named in documents", () => {
  const text = "2. Upper payment limit for Ozempic (semaglutide): staff update on proposed regulations. 3. Cost review: Trulicity and ENBREL biosimilars. Wegovyish is not a drug.";
  const terms = drugTerms([{ drug: "Ozempic" }, { drug: "Enbrel" }, { drug: "Jardiance" }, { drug: "ozempic" }], PRICES);

  it("builds search terms with generic names", () => {
    expect(terms.find((t) => t.label === "Ozempic")!.words).toEqual(expect.arrayContaining(["Ozempic", "semaglutide"]));
    expect(terms).toHaveLength(3);
  });

  it("finds whole words in any case, with the passage around them", () => {
    const found = findMentions(text, terms);
    expect(found.map((m) => m.term)).toEqual(["Ozempic", "Enbrel"]);
    expect(found[0].snippet).toContain("Upper payment limit for Ozempic");
    expect(findMentions("Wegovyish only", [{ label: "Wegovy", words: ["Wegovy"] }])).toEqual([]);
  });

  it("matches generic names too", () => {
    expect(findMentions("Etanercept review continues", terms).map((m) => m.term)).toEqual(["Enbrel"]);
  });
});

describe("dates written in documents", () => {
  const agenda = `Maryland Prescription Drug Affordability Board
Board Meeting Agenda
Monday, November 16, 2026, 1:00 p.m.
1. Welcome and approval of the October 19, 2026 minutes
2. Upper payment limit for Ozempic
Written comments on the proposed regulations must be received by
December 1, 2026. Send comments to the board.
Page 2: Public comment. The next meeting is January 25, 2027.`;

  it("reads dates in common formats", () => {
    expect(findDates("Sept. 9, 2026 and 11/16/2026 and February 30, 2026").map((d) => d.date)).toEqual(["2026-09-09", "2026-11-16"]);
  });

  it("finds the meeting, the comment deadline and the next meeting", () => {
    expect(findEventDates(agenda, { kind: "agenda", today: "2026-10-28" })).toEqual([
      { kind: "meeting", date: "2026-11-16", time: "1:00 PM", title: "Board meeting" },
      { kind: "comment_deadline", date: "2026-12-01", time: null, title: "Comments due" },
      { kind: "meeting", date: "2027-01-25", time: null, title: "Board meeting" },
    ]);
  });

  it("leaves past dates and passing mentions alone", () => {
    expect(findEventDates(agenda, { kind: "agenda", today: "2027-02-01" })).toEqual([]);
    expect(findEventDates("Annual report. In 2026 the board reviewed Enbrel. Its report is dated November 30, 2026.", { kind: "report", today: "2026-10-28" })).toEqual([]);
    expect(findEventDates("Notice of public hearing on proposed rules. The hearing will be held December 3, 2026 at 10 a.m.", { kind: "notice", today: "2026-10-28" })).toEqual([
      { kind: "hearing", date: "2026-12-03", time: "10:00 AM", title: "Public hearing" },
    ]);
  });

  it("doesn't mistake words that contain 'by' for a deadline", () => {
    expect(findEventDates("Public comment was heard in the lobby December 2, 2026.", { kind: "minutes", today: "2026-10-28" })).toEqual([]);
  });
});

describe("Medicare negotiated prices", () => {
  it("matches brand names, generic names and names with extra words", () => {
    expect(matchMedicarePrice("Ozempic", PRICES)?.id).toBe("semaglutide-2027");
    expect(matchMedicarePrice("Wegovy", PRICES)?.id).toBe("semaglutide-2027");
    expect(matchMedicarePrice("Enbrel (etanercept)", PRICES)?.id).toBe("enbrel-2026");
    expect(matchMedicarePrice("dapagliflozin", PRICES)?.id).toBe("farxiga-2026");
    expect(matchMedicarePrice("Trulicity", PRICES)).toBeNull();
    expect(matchMedicarePrice("Enbrelx", PRICES)).toBeNull();
  });

  it("formats dollars", () => {
    expect(formatUsd(2355)).toBe("$2,355");
    expect(formatUsd("178.50")).toBe("$178.50");
  });
});

describe("last checked", () => {
  const now = new Date("2026-12-15T12:00:00Z");
  it("says how long ago and flags anything over 30 days", () => {
    expect(checkAge(null, now)).toEqual({ label: "Not checked yet", stale: true, days: null });
    expect(checkAge("2026-12-15T09:00:00Z", now)).toMatchObject({ label: "Checked today", stale: false });
    expect(checkAge("2026-12-01T12:00:00Z", now)).toMatchObject({ label: "Checked 14 days ago", stale: false });
    expect(checkAge("2026-10-28T00:00:00Z", now)).toMatchObject({ days: 48, stale: true });
  });
});

describe("CourtListener", () => {
  it("reads docket links", () => {
    expect(parseCourtListenerUrl("https://www.courtlistener.com/docket/69510553/amgen-inc-v-mizner/")).toBe(69510553);
    expect(parseCourtListenerUrl("https://courtlistener.com/docket/123/")).toBe(123);
    expect(parseCourtListenerUrl("https://evil.example/courtlistener.com/docket/1/")).toBeNull();
    expect(parseCourtListenerUrl("https://www.courtlistener.com/opinion/1/x/")).toBeNull();
  });

  it("turns a docket entry into a filing", () => {
    const docket = "https://www.courtlistener.com/docket/69510553/amgen-inc-v-mizner/";
    expect(normalizeDocketEntry({ id: 991, entry_number: 72, date_filed: "2026-10-27", description: "  ORDER granting   motion to stay " }, docket)).toEqual({
      entry_key: "991", entry_number: 72, date_filed: "2026-10-27", description: "ORDER granting motion to stay", url: `${docket}#entry-72`,
    });
    expect(normalizeDocketEntry({ id: 5, entry_number: null, date_filed: null, description: "", recap_documents: [] }, docket)).toMatchObject({ description: "New docket entry", url: docket });
    expect(normalizeDocketEntry({}, docket)).toBeNull();
  });
});

describe("adding a court case", () => {
  it("takes a CourtListener link as all it needs", async () => {
    const { cleanCaseInput } = await import("@/lib/boardReading");
    expect(cleanCaseInput({ state: "md", name: " PhRMA v. Board ", court: "U.S. District Court for Maryland", link: "https://www.courtlistener.com/docket/123/phrma-v-board/" })).toEqual({
      fields: { state: "MD", name: "PhRMA v. Board", court: "U.S. District Court for Maryland", courtlistener_id: 123, url: "https://www.courtlistener.com/docket/123/phrma-v-board/" },
    });
    expect(cleanCaseInput({ court_code: "COD", docket_number: "1:25-cv-03452", link: "" }).fields).toEqual({ court_code: "cod", docket_number: "1:25-cv-03452", url: null });
    expect(cleanCaseInput({ name: "" }).error).toMatch(/Name the case/);
    expect(cleanCaseInput({ court_code: "c d" }).error).toMatch(/court code/);
    expect(cleanCaseInput({ link: "javascript:alert(1)" }).error).toMatch(/https/);
    expect(cleanCaseInput({ board_drug_id: "x" }).error).toBe("Unknown drug.");
  });
});

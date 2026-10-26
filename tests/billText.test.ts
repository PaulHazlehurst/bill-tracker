import { describe, expect, it } from "vitest";
import { parseBillSections, parsePlainSections, packageIdFromUrl, versionCode, comparableVersions } from "@/lib/billText";

const XML = `<?xml version="1.0"?>
<!DOCTYPE bill PUBLIC "-//US Congress//DTDs/bill.dtd//EN" "bill.dtd">
<bill bill-stage="Reported-in-House">
<form><distribution-code>I</distribution-code><congress>119th CONGRESS</congress></form>
<legis-body>
<section id="H1" section-type="section-one"><enum>1.</enum><header>Short title</header><text display-inline="no-display-inline">This Act may be cited as the <quote>Rural Hospital Stabilization Act</quote>.</text></section>
<section id="H2"><enum>2.</enum><header>Payment adjustment</header>
<subsection id="H3"><enum>(a)</enum><header>In general</header><text>Section 1886(d) of the Social Security Act is amended by adding at the end the following:</text>
<quoted-block style="OLC" id="H4"><section id="H5"><enum>(t)</enum><header>Rural add-on</header><text>A hospital with fewer than 50 beds &amp; a critical access designation shall receive 7.5 percent.</text></section></quoted-block><after-quoted-block>.</after-quoted-block>
</subsection></section>
<section id="H6"><enum>3.</enum><header>AUTHORIZATION OF APPROPRIATIONS</header><text>There are authorized to be appropriated $400,000,000.</text></section>
</legis-body>
</bill>`;

describe("reading bill XML", () => {
  const sections = parseBillSections(XML);

  it("splits top-level sections and keeps quoted law inside the section that quotes it", () => {
    expect(sections.map((s) => s.num)).toEqual(["1", "2", "3"]);
    expect(sections[1].text).toContain("Rural add-on");
    expect(sections[1].text).toContain("fewer than 50 beds & a critical access designation");
  });

  it("separates the number and heading from the wording", () => {
    expect(sections[0].header).toBe("Short title");
    expect(sections[0].text).toBe("This Act may be cited as the Rural Hospital Stabilization Act .");
    expect(sections[2].header).toBe("Authorization of appropriations");
  });

  it("falls back to one block when a short resolution has no sections", () => {
    const r = parseBillSections("<resolution><resolution-body><text>Expressing support for rural health.</text></resolution-body></resolution>");
    expect(r).toEqual([{ key: "text", num: "", header: "Text", text: "Expressing support for rural health." }]);
  });
});

describe("plain-text fallback", () => {
  it("splits on SEC. headings", () => {
    const s = parsePlainSections(`<html><body><pre>
119th CONGRESS
  1st Session
                                H. R. 4120

    Be it enacted by the Senate and House of Representatives,

SECTION 1. SHORT TITLE.

    This Act may be cited as the \`\`Rural Hospital Stabilization Act''.

SEC. 2. PAYMENT ADJUSTMENT.

    (a) In General.--A hospital shall receive 5 percent.
</pre></body></html>`);
    expect(s.map((x) => [x.num, x.header])).toEqual([["", "Opening"], ["1", "Short title"], ["2", "Payment adjustment"]]);
    expect(s[2].text).toContain("5 percent");
  });
});

describe("version identifiers", () => {
  it("finds the package id in congress.gov and GovInfo links", () => {
    expect(packageIdFromUrl("https://www.congress.gov/119/bills/hr4120/BILLS-119hr4120ih.htm")).toBe("BILLS-119hr4120ih");
    expect(packageIdFromUrl("https://www.govinfo.gov/content/pkg/BILLS-119s283rs/xml/BILLS-119s283rs.xml")).toBe("BILLS-119s283rs");
    expect(versionCode("BILLS-119hr4120enr")).toBe("enr");
    expect(versionCode("BILLS-119hconres12ih")).toBe("ih");
  });

  it("lists versions oldest first and drops duplicates", () => {
    const v = comparableVersions([
      { type: "Reported in House", date: "2026-10-09T04:00:00Z", formats: [{ type: "Formatted Text", url: "https://www.congress.gov/119/bills/hr4120/BILLS-119hr4120rh.htm" }, { type: "Formatted XML", url: "https://www.congress.gov/119/bills/hr4120/BILLS-119hr4120rh.xml" }] },
      { type: "Introduced in House", date: "2026-03-04T05:00:00Z", formats: [{ type: "PDF", url: "https://www.congress.gov/119/bills/hr4120/BILLS-119hr4120ih.pdf" }] },
      { type: "Introduced in House", date: "2026-03-04T05:00:00Z", formats: [{ type: "Formatted Text", url: "https://www.congress.gov/119/bills/hr4120/BILLS-119hr4120ih.htm" }] },
    ]);
    expect(v.map((x) => x.packageId)).toEqual(["BILLS-119hr4120ih", "BILLS-119hr4120rh"]);
    expect(v[1].xmlUrl).toMatch(/rh\.xml$/);
    expect(v[0].date).toBe("2026-03-04");
  });
});

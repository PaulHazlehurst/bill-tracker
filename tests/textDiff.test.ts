import { describe, expect, it } from "vitest";
import { myersDiff, diffVersions, foldOps, humanizeAmount, diffHeadline, tokenize, type Section, type Op } from "@/lib/textDiff";

function apply(a: string[], ops: Op[]): { before: string[]; after: string[] } {
  const before: string[] = [];
  const after: string[] = [];
  for (const op of ops) {
    if (op.t === "gap") continue;
    const words = op.s.split(" ");
    if (op.t !== "ins") before.push(...words);
    if (op.t !== "del") after.push(...words);
  }
  return { before, after };
}

describe("word diff", () => {
  it("produces an edit script that rebuilds both texts exactly", () => {
    const cases: [string, string][] = [
      ["a b c d e f", "a b x d e f g"],
      ["the quick brown fox", "the slow brown dog jumps"],
      ["", "brand new text"],
      ["all of this goes", ""],
      ["same same same", "same same same"],
      ["x y z", "z y x"],
    ];
    for (const [from, to] of cases) {
      const a = tokenize(from);
      const b = tokenize(to);
      const ops = myersDiff(a, b)!;
      expect(ops).not.toBeNull();
      const { before, after } = apply(a, ops);
      expect(before).toEqual(a);
      expect(after).toEqual(b);
    }
  });

  it("finds the minimal change in random edits", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 40; n++) {
      const a = Array.from({ length: 60 }, () => `w${Math.floor(rand() * 12)}`);
      const b = a.filter(() => rand() > 0.15).map((w) => (rand() > 0.9 ? `${w}x` : w));
      const ops = myersDiff(a, b)!;
      const { before, after } = apply(a, ops);
      expect(before).toEqual(a);
      expect(after).toEqual(b);
    }
  });

  it("gives up gracefully on texts that are too different", () => {
    const a = Array.from({ length: 200 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 200 }, (_, i) => `b${i}`);
    expect(myersDiff(a, b, 50)).toBeNull();
  });

  it("folds long unchanged stretches to a few words of context", () => {
    const long = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    const folded = foldOps([{ t: "eq", s: long }, { t: "del", s: "old" }, { t: "ins", s: "new" }, { t: "eq", s: long }], 5);
    expect(folded[0]).toEqual({ t: "gap", n: 95 });
    expect(folded[1]).toEqual({ t: "eq", s: "w95 w96 w97 w98 w99" });
    expect(folded[folded.length - 1]).toEqual({ t: "gap", n: 95 });
  });
});

const sec = (num: string, header: string, text: string): Section => ({ key: `${num}|${header.toLowerCase()}`, num, header, text });

describe("comparing versions", () => {
  const before = [
    sec("1", "Short title", "This Act may be cited as the Rural Hospital Stabilization Act."),
    sec("2", "Payment adjustment", "a hospital with fewer than 25 beds shall receive an add-on payment equal to 5 percent of the amount otherwise payable for fiscal years 2027 and 2028."),
    sec("3", "Authorization of appropriations", "There are authorized to be appropriated $250,000,000 for each of fiscal years 2027 through 2028."),
    sec("4", "Report", "The Secretary shall submit a report to Congress."),
  ];
  const after = [
    sec("1", "Short title", "This Act may be cited as the Rural Hospital Stabilization Act."),
    sec("2", "Payment adjustment", "a hospital with fewer than 50 beds shall receive an add-on payment equal to 7.5 percent of the amount otherwise payable for fiscal years 2027 through 2030."),
    sec("3", "Rural emergency transition grants", "The Secretary shall award grants to hospitals that convert to rural emergency hospitals."),
    sec("4", "Authorization of appropriations", "There are authorized to be appropriated $400,000,000 for each of fiscal years 2027 through 2030."),
  ];
  const r = diffVersions(before, after);

  it("pairs renumbered sections by heading and spots new and removed ones", () => {
    const by = Object.fromEntries(r.sections.map((s) => [s.header, s.status]));
    expect(by["Short title"]).toBe("same");
    expect(by["Payment adjustment"]).toBe("changed");
    expect(by["Rural emergency transition grants"]).toBe("added");
    expect(by["Authorization of appropriations"]).toBe("changed");
    expect(by["Report"]).toBe("removed");
    // The removed section sits where it was, after the sections that came before it.
    expect(r.sections.map((s) => s.header).indexOf("Report")).toBe(r.sections.length - 1);
  });

  it("pulls out the numbers that changed, in plain terms", () => {
    const pairs = r.numbers.map((n) => `${n.from} -> ${n.to}`);
    expect(pairs).toContain("25 beds -> 50 beds");
    expect(pairs).toContain("5 percent -> 7.5 percent");
    expect(pairs).toContain("$250 million -> $400 million");
    expect(pairs).toContain("2028 -> 2030");
  });

  it("summarises the comparison in one sentence", () => {
    expect(diffHeadline(r)).toMatch(/^1 new section, 2 changed and 1 removed\. \d+ words added, \d+ removed\.$/);
    expect(diffHeadline(diffVersions(before, before))).toBe("The two versions have the same text.");
  });

  it("formats dollar amounts", () => {
    expect(humanizeAmount("$1,500,000,000")).toBe("$1.5 billion");
    expect(humanizeAmount("$12,345")).toBe("$12,345");
  });
});

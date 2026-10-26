// Compares two versions of a bill's text, section by section, word by word.
// Pure (no I/O): lib/billText.ts fetches and parses the text; this works out
// what changed. Tested in tests/textDiff.test.ts.
//
// How it works:
//  1. Sections are paired up between versions by heading first (so a
//     section that was renumbered because a new one was inserted above it
//     still pairs with itself), then by number, then by similar wording.
//  2. Paired sections are compared word by word with Myers' diff algorithm
//     (the one behind `git diff`), after trimming the identical start and
//     end, which is where most of a bill's text is.
//  3. Long unchanged stretches are folded down to a few words of context
//     either side of each change, so a 300-page bill's comparison stays a
//     small payload.
//  4. Dollar amounts, percentages, years and counts that were swapped for
//     different ones are pulled out into a "numbers that changed" list.

export type Section = { key: string; num: string; header: string; text: string };

export type Op = { t: "eq" | "del" | "ins"; s: string } | { t: "gap"; n: number };

export type SectionDiff = {
  key: string;
  num: string;
  header: string;
  status: "same" | "changed" | "rewritten" | "added" | "removed";
  added: number;
  removed: number;
  words: number;
  ops?: Op[];
};

export type NumberChange = { section: string; from: string; to: string; context: string };

export type DiffResult = {
  sections: SectionDiff[];
  totals: { added: number; removed: number; sectionsChanged: number; sectionsAdded: number; sectionsRemoved: number };
  numbers: NumberChange[];
};

const CONTEXT_WORDS = 12;
const MAX_EDIT_DISTANCE = 2500;

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Myers' O(ND) diff over word arrays. Returns null if the texts differ by more than maxD edits. */
export function myersDiff(a: string[], b: string[], maxD = MAX_EDIT_DISTANCE): Op[] | null {
  // Identical start and end are the common case; peel them off first.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);

  const core = coreDiff(A, B, maxD);
  if (!core) return null;
  const ops: Op[] = [];
  const push = (t: "eq" | "del" | "ins", s: string) => {
    const last = ops[ops.length - 1];
    if (last && last.t === t) (last as { s: string }).s += ` ${s}`;
    else ops.push({ t, s });
  };
  if (pre) push("eq", a.slice(0, pre).join(" "));
  for (const op of core) push(op.t, op.s);
  if (suf) push("eq", a.slice(a.length - suf).join(" "));
  return ops;
}

function coreDiff(a: string[], b: string[], maxD: number): { t: "eq" | "del" | "ins"; s: string }[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((s) => ({ t: "ins" as const, s }));
  if (m === 0) return a.map((s) => ({ t: "del" as const, s }));

  const max = Math.min(n + m, maxD);
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;

  // Walk back through the saved states to recover the edit script.
  const out: { t: "eq" | "del" | "ins"; s: string }[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ t: "eq", s: a[x - 1] });
      x--;
      y--;
    }
    if (x === prevX) out.push({ t: "ins", s: b[y - 1] });
    else out.push({ t: "del", s: a[x - 1] });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    out.push({ t: "eq", s: a[x - 1] });
    x--;
    y--;
  }
  return out.reverse();
}

/** Folds long unchanged runs down to a little context either side of each change. */
export function foldOps(ops: Op[], context = CONTEXT_WORDS): Op[] {
  const out: Op[] = [];
  ops.forEach((op, i) => {
    if (op.t !== "eq") {
      out.push(op);
      return;
    }
    const words = op.s.split(" ");
    const first = i === 0;
    const last = i === ops.length - 1;
    const keepHead = first ? 0 : context;
    const keepTail = last ? 0 : context;
    if (words.length <= keepHead + keepTail + 4) {
      out.push(op);
      return;
    }
    if (keepHead) out.push({ t: "eq", s: words.slice(0, keepHead).join(" ") });
    out.push({ t: "gap", n: words.length - keepHead - keepTail });
    if (keepTail) out.push({ t: "eq", s: words.slice(words.length - keepTail).join(" ") });
  });
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function jaccard(a: string, b: string) {
  const A = new Set(tokenize(norm(a)));
  const B = new Set(tokenize(norm(b)));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Pairs sections between two versions: by heading, then number, then similar wording. Returns new-index -> old-index. */
export function matchSections(oldS: Section[], newS: Section[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const usedOld = new Set<number>();
  const pass = (eq: (o: Section, n: Section) => boolean) => {
    newS.forEach((n, ni) => {
      if (pairs.has(ni)) return;
      const oi = oldS.findIndex((o, i) => !usedOld.has(i) && eq(o, n));
      if (oi >= 0) {
        pairs.set(ni, oi);
        usedOld.add(oi);
      }
    });
  };
  pass((o, n) => !!norm(n.header) && norm(o.header) === norm(n.header));
  pass((o, n) => !!n.num && o.num === n.num && jaccard(o.text, n.text) > 0.2);
  pass((o, n) => jaccard(o.text, n.text) >= 0.5);
  return pairs;
}

const NUMBER_RX = /\$\s?[\d,]+(?:\.\d+)?(?:\s(?:thousand|million|billion|trillion))?|\b\d+(?:\.\d+)?\s?(?:percent\b|%)|\b(?:19|20)\d{2}\b|\b\d[\d,]*\s(?:days?|weeks?|months?|years?|beds?|hours?|miles?|individuals|employees|members)\b/gi;

export function humanizeAmount(s: string): string {
  const m = s.replace(/\s/g, "").match(/^\$([\d,]+)(?:\.(\d+))?$/);
  if (!m) return s;
  const n = Number(m[1].replace(/,/g, ""));
  if (n >= 1e12 && n % 1e10 === 0) return `$${trim(n / 1e12)} trillion`;
  if (n >= 1e9 && n % 1e7 === 0) return `$${trim(n / 1e9)} billion`;
  if (n >= 1e6 && n % 1e4 === 0) return `$${trim(n / 1e6)} million`;
  return s;
}
function trim(n: number) {
  return String(Math.round(n * 100) / 100);
}

/** Numbers swapped for other numbers inside one change. */
export function numbersChanged(ops: Op[], section: string): NumberChange[] {
  const out: NumberChange[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === "eq" || ops[i].t === "gap") {
      i++;
      continue;
    }
    const before = i > 0 && ops[i - 1].t === "eq" ? (ops[i - 1] as { s: string }).s.split(" ").slice(-6).join(" ") : "";
    let del = "";
    let ins = "";
    while (i < ops.length && (ops[i].t === "del" || ops[i].t === "ins")) {
      const op = ops[i] as { t: "del" | "ins"; s: string };
      if (op.t === "del") del += ` ${op.s}`;
      else ins += ` ${op.s}`;
      i++;
    }
    // The unit often sits just after the change ("25" -> "50" in "fewer than 25 beds"),
    // so read a couple of the following unchanged words on both sides.
    const next = i < ops.length && ops[i].t === "eq" ? (ops[i] as { s: string }).s.split(" ").slice(0, 2).join(" ") : "";
    if (!del.trim() || !ins.trim()) continue;
    const from = `${del} ${next}`.match(NUMBER_RX) ?? [];
    const to = `${ins} ${next}`.match(NUMBER_RX) ?? [];
    const pairs = Math.min(from.length, to.length);
    for (let p = 0; p < pairs; p++) {
      if (from[p].replace(/\s/g, "") === to[p].replace(/\s/g, "")) continue;
      out.push({ section, from: humanizeAmount(from[p].trim()), to: humanizeAmount(to[p].trim()), context: before });
    }
  }
  return out;
}

function sectionLabel(s: Pick<Section, "num" | "header">) {
  const num = s.num.replace(/\.$/, "");
  if (num && s.header) return `Sec. ${num}, ${s.header}`;
  if (num) return `Sec. ${num}`;
  return s.header || "Text";
}

export function diffVersions(oldS: Section[], newS: Section[]): DiffResult {
  const pairs = matchSections(oldS, newS);
  const oldMatched = new Set(pairs.values());
  const sections: SectionDiff[] = [];
  const numbers: NumberChange[] = [];

  // Removed sections are placed after whatever came before them in the old version.
  const removedAfter = new Map<number, number[]>(); // new index (or -1) -> old indexes
  const newIndexOfOld = new Map<number, number>();
  for (const [ni, oi] of pairs) newIndexOfOld.set(oi, ni);
  oldS.forEach((_, oi) => {
    if (oldMatched.has(oi)) return;
    let anchor = -1;
    for (let j = oi - 1; j >= 0; j--) {
      if (newIndexOfOld.has(j)) {
        anchor = newIndexOfOld.get(j)!;
        break;
      }
    }
    removedAfter.set(anchor, [...(removedAfter.get(anchor) ?? []), oi]);
  });

  const pushRemoved = (anchor: number) => {
    for (const oi of removedAfter.get(anchor) ?? []) {
      const o = oldS[oi];
      const words = tokenize(o.text).length;
      sections.push({ key: `old-${o.key}`, num: o.num, header: o.header, status: "removed", added: 0, removed: words, words, ops: foldOps([{ t: "del", s: truncateWords(o.text, 400) }]) });
    }
  };

  pushRemoved(-1);
  newS.forEach((n, ni) => {
    const oi = pairs.get(ni);
    const newWords = tokenize(n.text);
    if (oi === undefined) {
      sections.push({ key: n.key, num: n.num, header: n.header, status: "added", added: newWords.length, removed: 0, words: newWords.length, ops: [{ t: "ins", s: truncateWords(n.text, 400) }] });
    } else {
      const o = oldS[oi];
      const oldWords = tokenize(o.text);
      const ops = myersDiff(oldWords, newWords);
      if (!ops) {
        sections.push({ key: n.key, num: n.num, header: n.header, status: "rewritten", added: newWords.length, removed: oldWords.length, words: newWords.length, ops: [{ t: "del", s: truncateWords(o.text, 200) }, { t: "ins", s: truncateWords(n.text, 200) }] });
      } else {
        let added = 0;
        let removed = 0;
        for (const op of ops) {
          if (op.t === "ins") added += op.s.split(" ").length;
          if (op.t === "del") removed += op.s.split(" ").length;
        }
        if (!added && !removed) {
          sections.push({ key: n.key, num: n.num, header: n.header, status: "same", added: 0, removed: 0, words: newWords.length });
        } else {
          // "Rewritten" when most of the old wording went and most of the new is fresh.
          const status = removed > 0.7 * oldWords.length && added > 0.7 * newWords.length ? "rewritten" : "changed";
          numbers.push(...numbersChanged(ops, sectionLabel(n)));
          sections.push({ key: n.key, num: n.num, header: n.header, status, added, removed, words: newWords.length, ops: foldOps(ops) });
        }
      }
    }
    pushRemoved(ni);
  });

  const totals = {
    added: sections.reduce((s, x) => s + x.added, 0),
    removed: sections.reduce((s, x) => s + x.removed, 0),
    sectionsChanged: sections.filter((s) => s.status === "changed" || s.status === "rewritten").length,
    sectionsAdded: sections.filter((s) => s.status === "added").length,
    sectionsRemoved: sections.filter((s) => s.status === "removed").length,
  };
  return { sections, totals, numbers: numbers.slice(0, 40) };
}

function truncateWords(text: string, max: number) {
  const words = tokenize(text);
  return words.length <= max ? words.join(" ") : `${words.slice(0, max).join(" ")} …`;
}

/** One plain sentence summarising the comparison. */
export function diffHeadline(r: DiffResult): string {
  const { sectionsAdded, sectionsRemoved, sectionsChanged } = r.totals;
  if (!sectionsAdded && !sectionsRemoved && !sectionsChanged) return "The two versions have the same text.";
  const parts: string[] = [];
  if (sectionsAdded) parts.push(`${sectionsAdded} new section${sectionsAdded === 1 ? "" : "s"}`);
  if (sectionsChanged) parts.push(`${sectionsChanged} changed`);
  if (sectionsRemoved) parts.push(`${sectionsRemoved} removed`);
  const last = parts.pop()!;
  const list = parts.length ? `${parts.join(", ")} and ${last}` : last;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}. ${r.totals.added.toLocaleString("en-US")} words added, ${r.totals.removed.toLocaleString("en-US")} removed.`;
}

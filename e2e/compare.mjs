// Compares the screenshots of this change ("after") with the same pages on
// the base branch ("before"), pixel by pixel, and writes a table of what
// changed to the job summary, with highlighted difference images alongside.
// Never fails: changing how a page looks is often the point. It's there so
// unintended changes get seen. Usage:
//   node e2e/compare.mjs --before e2e-out/before --after e2e-out/after --out e2e-out/diff
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const before = arg("before", "e2e-out/before");
const after = arg("after", "e2e-out/after");
const out = arg("out", "e2e-out/diff");
mkdirSync(out, { recursive: true });

const rows = [];
for (const file of readdirSync(after).filter((f) => f.endsWith(".png")).sort()) {
  const a = PNG.sync.read(readFileSync(path.join(after, file)));
  if (!existsSync(path.join(before, file))) {
    rows.push({ file, status: "New page", pct: null });
    continue;
  }
  const b = PNG.sync.read(readFileSync(path.join(before, file)));
  // Compare on a canvas big enough for both; extra height counts as changed.
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const pad = (img) => {
    const p = new PNG({ width: w, height: h });
    p.data.fill(255);
    PNG.bitblt(img, p, 0, 0, img.width, img.height, 0, 0);
    return p;
  };
  const A = pad(a);
  const B = pad(b);
  const diff = new PNG({ width: w, height: h });
  const changed = pixelmatch(B.data, A.data, diff.data, w, h, { threshold: 0.12, includeAA: false });
  const pct = (changed / (w * h)) * 100;
  if (changed > 0) writeFileSync(path.join(out, file), PNG.sync.write(diff));
  rows.push({ file, status: changed === 0 ? "Same" : pct < 0.05 ? "Tiny change" : "Changed", pct, heightChange: a.height - b.height });
}

const changedRows = rows.filter((r) => r.status !== "Same");
const lines = [
  "## How the pages look",
  "",
  changedRows.length
    ? `${changedRows.length} of ${rows.length} screenshots differ from the base branch. Download the **screenshots** artifact to see them; the \`diff\` folder highlights what moved in red.`
    : `All ${rows.length} screenshots match the base branch.`,
  "",
];
if (changedRows.length) {
  lines.push("| Page and size | What happened | Pixels changed | Height |", "|---|---|---|---|");
  for (const r of changedRows) lines.push(`| ${r.file.replace(".png", "")} | ${r.status} | ${r.pct == null ? "" : `${r.pct.toFixed(2)}%`} | ${r.heightChange ? `${r.heightChange > 0 ? "+" : ""}${r.heightChange}px` : ""} |`);
}
const md = lines.join("\n") + "\n";
writeFileSync(path.join(out, "summary.md"), md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);

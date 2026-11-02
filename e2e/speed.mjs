// Lighthouse speed check for the pages marked `speed: true` in pages.mjs,
// as a mid-range phone on a slow 4G connection would see them (Lighthouse's
// standard mobile test). Fails if a page goes over the limits in
// budgets.json, so a change that makes the app slower is caught before it
// ships. Writes a table to the job summary. Usage:
//   node e2e/speed.mjs --base-url http://localhost:3100 --out e2e-out/speed
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import { chromium } from "playwright";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES } from "./pages.mjs";
import { sessionCookie } from "./session.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const baseUrl = arg("base-url", "http://localhost:3100");
const out = arg("out", "e2e-out/speed");
mkdirSync(out, { recursive: true });
const budget = JSON.parse(readFileSync(path.join(here, "budgets.json"), "utf8"));
const cookie = sessionCookie();

const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ["--headless=new", "--no-sandbox"] });
// The sign-in cookie has to live in the browser itself (the app reads it in
// the page), so it's set over the DevTools connection, and Lighthouse is
// told not to clear it. Signed-out pages run first, before it's set.
const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
const signIn = () => cdp.contexts()[0].addCookies([{ ...cookie, url: baseUrl }]);
const rows = [];
try {
  const pages = PAGES.filter((p) => p.speed).sort((a, b) => Number(a.signedIn !== false) - Number(b.signedIn !== false));
  let signedIn = false;
  for (const pg of pages) {
    if (pg.signedIn !== false && !signedIn) {
      await signIn();
      signedIn = true;
    }
    const flags = { port: chrome.port, logLevel: "error", onlyCategories: ["performance"], disableStorageReset: true };
    // Twice: the first visit warms the server up, the second is measured.
    await lighthouse(baseUrl + pg.path, { ...flags, output: "json" });
    const result = await lighthouse(baseUrl + pg.path, { ...flags, output: "html" });
    if (pg.signedIn !== false && /\/login/.test(result.lhr.finalDisplayedUrl ?? "")) throw new Error(`${pg.path} sent the speed check to the login page; the test sign-in didn't work`);
    const lhr = result.lhr;
    writeFileSync(path.join(out, `${pg.name}.html`), result.report);
    const a = lhr.audits;
    // JavaScript the page runs (uncompressed), whether or not it was cached.
    const scriptKb = Math.round((a["network-requests"]?.details?.items ?? []).filter((r) => r.resourceType === "Script").reduce((sum, r) => sum + (r.resourceSize ?? 0), 0) / 1024);
    const row = {
      page: pg.path,
      score: Math.round((lhr.categories.performance.score ?? 0) * 100),
      lcp: Math.round(a["largest-contentful-paint"].numericValue),
      cls: Number(a["cumulative-layout-shift"].numericValue.toFixed(3)),
      tbt: Math.round(a["total-blocking-time"].numericValue),
      scriptKb,
    };
    row.over = [
      row.score < budget.minScore && `score ${row.score} (needs ${budget.minScore})`,
      row.lcp > budget.maxLcpMs && `main content shows at ${(row.lcp / 1000).toFixed(1)}s (limit ${(budget.maxLcpMs / 1000).toFixed(1)}s)`,
      row.cls > budget.maxLayoutShift && `layout shift ${row.cls} (limit ${budget.maxLayoutShift})`,
      row.tbt > budget.maxBlockingMs && `blocked for ${row.tbt}ms (limit ${budget.maxBlockingMs}ms)`,
      row.scriptKb > budget.maxScriptKb && `${row.scriptKb} KB of JavaScript (limit ${budget.maxScriptKb} KB)`,
    ].filter(Boolean);
    rows.push(row);
    console.log(`${row.over.length ? "✗" : "✓"} ${pg.path}: score ${row.score}, LCP ${row.lcp}ms, CLS ${row.cls}, TBT ${row.tbt}ms, JS ${row.scriptKb} KB${row.over.length ? `\n    over budget: ${row.over.join("; ")}` : ""}`);
  }
} finally {
  await cdp.close().catch(() => {});
  await chrome.kill();
}

const md = [
  "## Speed (Lighthouse, mobile)",
  "",
  "| Page | Score | Main content shows | Layout shift | Blocked time | JavaScript | |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.page} | ${r.score} | ${(r.lcp / 1000).toFixed(1)}s | ${r.cls} | ${r.tbt}ms | ${r.scriptKb} KB | ${r.over.length ? `Over: ${r.over.join("; ")}` : "Within limits"} |`),
  "",
  `Limits are in \`e2e/budgets.json\`. Full reports are in the **speed** artifact.`,
  "",
].join("\n");
writeFileSync(path.join(out, "summary.md"), md);
writeFileSync(path.join(out, "results.json"), JSON.stringify(rows, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (rows.some((r) => r.over.length)) {
  console.error("\nA page is over its speed limit. See above.");
  process.exit(1);
}

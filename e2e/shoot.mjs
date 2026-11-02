// Screenshots every page in e2e/pages.mjs at desktop and phone width, signed
// in as the made-up user, with the app's own data requests answered from
// e2e/fixtures/app-api.json and everything else from the stand-in database.
//
// Fails (exit 1) if a page crashes or scrolls sideways on a phone, so those
// are caught before a change ships. Usage:
//   node e2e/shoot.mjs --base-url http://localhost:3100 --out e2e-out/after
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES, SIZES } from "./pages.mjs";
import { sessionCookie } from "./session.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const baseUrl = arg("base-url", "http://localhost:3100");
const out = arg("out", "e2e-out/after");
mkdirSync(out, { recursive: true });
const F = JSON.parse(readFileSync(path.join(here, "fixtures/app-api.json"), "utf8"));

// App routes answered from fixtures (they need data the stand-in database doesn't have).
function fixtureFor(url) {
  const u = new URL(url);
  const p = u.pathname;
  if (F.api[p]) return F.api[p];
  if (p === "/api/week") return u.searchParams.get("scope") === "all" ? F.weekAll : F.weekMine;
  if (p === "/api/week/refresh") return {};
  if (p === "/api/bills/text-diff") return F.textDiff;
  if (p === "/api/clients") return F.clients;
  if (p === "/api/clients/c1") return F.clientDetail;
  if (p === "/api/clients/c1/report") return F.clientReport;
  if (p === "/api/drug-boards") return F.drugBoards;
  if (p === "/api/calendar/link") return F.calendarLink;
  return null;
}

// Screenshots should show the finished page, not a frame mid-animation.
const STILL = "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }";

const browser = await chromium.launch();
const results = [];
let failed = false;

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "light", timezoneId: "America/New_York", locale: "en-US" });
  await ctx.addCookies([{ ...sessionCookie(), url: baseUrl }]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.fulfill({ status: 204, body: "" })); // no outside requests
  await ctx.route(`${baseUrl}/api/**`, (route) => {
    const body = route.request().method() === "GET" ? fixtureFor(route.request().url()) : null;
    return body ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }) : route.fallback();
  });

  for (const pg of PAGES) {
    const page = await ctx.newPage();
    if (pg.signedIn === false) await ctx.clearCookies();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    const started = Date.now();
    try {
      await page.goto(baseUrl + pg.path, { waitUntil: "networkidle", timeout: 60_000 });
    } catch (e) {
      errors.push(`didn't finish loading: ${String(e.message ?? e).split("\n")[0]}`);
    }
    await page.addStyleTag({ content: STILL }).catch(() => {});
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const wide = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.right > W + 1)) continue;
        // Wide content inside its own scrolling box (a table, say) is fine.
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) { clipped = true; break; }
        }
        if (!clipped && getComputedStyle(el).position !== "fixed") wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
      }
      return { scrolls: document.documentElement.scrollWidth > W + 1, wide: wide.slice(0, 5) };
    });
    const file = `${pg.name}-${size.name}.png`;
    await page.screenshot({ path: path.join(out, file), fullPage: true });
    const problems = [...errors];
    if (size.name === "phone" && overflow.scrolls) problems.push(`scrolls sideways on a phone (too wide: ${overflow.wide.join(", ") || "unknown"})`);
    if (errors.some((e) => !e.startsWith("console:")) || (size.name === "phone" && overflow.scrolls)) failed = true;
    results.push({ page: pg.name, path: pg.path, size: size.name, file, ms: Date.now() - started, problems });
    console.log(`${problems.length ? "✗" : "✓"} ${pg.path} (${size.name})${problems.length ? `\n    ${problems.join("\n    ")}` : ""}`);
    await page.close();
    if (pg.signedIn === false) await ctx.addCookies([{ ...sessionCookie(), url: baseUrl }]);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
if (failed) {
  console.error("\nSome pages crashed or scroll sideways on a phone. See above.");
  process.exit(1);
}

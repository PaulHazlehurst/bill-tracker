import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { ldaFetch } from "@/lib/lda-api";
import { MIGRATIONS, migrationStatus } from "@/lib/migrations";
import { assessJob, JOB_LABELS, type JobRun } from "@/lib/jobLog";

export const maxDuration = 30;

type Status = "ok" | "warn" | "fail" | "skip";
type Check = { id: string; group: string; name: string; status: Status; detail: string; ms?: number; fix?: string };

const TIMEOUT_MS = 9_000;

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const value = await fn(ctrl.signal);
    return { value, ms: Date.now() - started };
  } catch (err: any) {
    return { error: err?.name === "AbortError" ? `no response within ${TIMEOUT_MS / 1000}s` : String(err?.message ?? err), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function httpCheck(id: string, group: string, name: string, url: string, init: RequestInit = {}, okDetail = "Responding"): Promise<Check> {
  const r = await timed((signal) => fetch(url, { ...init, signal, cache: "no-store" }));
  if (r.error) return { id, group, name, status: "fail", detail: `Couldn't connect: ${r.error}`, ms: r.ms };
  const res = r.value!;
  if (res.status === 401 || res.status === 403) return { id, group, name, status: "fail", detail: `Rejected the API key (HTTP ${res.status})`, ms: r.ms, fix: "Check the key in Vercel → Settings → Environment Variables, then redeploy." };
  if (res.status === 429) return { id, group, name, status: "warn", detail: "Rate limit reached right now (HTTP 429). Usually clears within an hour.", ms: r.ms };
  if (!res.ok) return { id, group, name, status: "fail", detail: `Returned HTTP ${res.status}`, ms: r.ms };
  const remaining = res.headers.get("x-ratelimit-remaining");
  return { id, group, name, status: "ok", detail: remaining ? `${okDetail}. ${Number(remaining).toLocaleString()} requests left this hour.` : okDetail, ms: r.ms };
}

// GET - runs a live check of every service and setting the app depends on.
// Never returns secret values, only whether they're set and whether they work.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const env = process.env;
  const checks: Promise<Check>[] = [];
  const admin = env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;

  // ── Configuration ──
  const config: Check[] = [
    { id: "env-congress", group: "Settings", name: "Congress.gov API key", status: env.CONGRESS_API_KEY ? "ok" : "fail", detail: env.CONGRESS_API_KEY ? "Set" : "Missing. Bill data can't load.", fix: env.CONGRESS_API_KEY ? undefined : "Add CONGRESS_API_KEY in Vercel (free from api.congress.gov/sign-up)." },
    { id: "env-cron", group: "Settings", name: "Scheduled check password", status: env.CRON_SECRET ? "ok" : "fail", detail: env.CRON_SECRET ? "Set" : "Missing. The morning check and alerts will refuse to run.", fix: env.CRON_SECRET ? undefined : "Add CRON_SECRET in Vercel (any long random string)." },
    { id: "env-service", group: "Settings", name: "Database admin key", status: env.SUPABASE_SERVICE_ROLE_KEY ? "ok" : "fail", detail: env.SUPABASE_SERVICE_ROLE_KEY ? "Set" : "Missing. Background jobs can't write to the database.", fix: env.SUPABASE_SERVICE_ROLE_KEY ? undefined : "Add SUPABASE_SERVICE_ROLE_KEY in Vercel." },
    {
      id: "env-appurl", group: "Settings", name: "App address for email links",
      status: env.NEXT_PUBLIC_APP_URL ? (/^https:\/\//.test(env.NEXT_PUBLIC_APP_URL) ? "ok" : "warn") : "fail",
      detail: env.NEXT_PUBLIC_APP_URL ? (/^https:\/\//.test(env.NEXT_PUBLIC_APP_URL) ? env.NEXT_PUBLIC_APP_URL : `Set to "${env.NEXT_PUBLIC_APP_URL}", which doesn't start with https://`) : "Missing. Links in alert emails won't open the app.",
      fix: env.NEXT_PUBLIC_APP_URL ? undefined : "Add NEXT_PUBLIC_APP_URL in Vercel, e.g. https://your-app.vercel.app, then redeploy.",
    },
    { id: "env-govinfo", group: "Settings", name: "GovInfo key", status: env.GOVINFO_API_KEY || env.CONGRESS_API_KEY ? "ok" : "warn", detail: env.GOVINFO_API_KEY ? "Set" : env.CONGRESS_API_KEY ? "Using the congress.gov key (same api.data.gov account)" : "Using the shared demo key, which is heavily rate-limited" },
    { id: "env-lda", group: "Settings", name: "Lobbying data key", status: env.LDA_API_KEY ? "ok" : "warn", detail: env.LDA_API_KEY ? "Set" : "Not set. Works, but limited to 15 requests a minute.", fix: env.LDA_API_KEY ? undefined : "Optional: register at lda.gov for a free key and add LDA_API_KEY." },
  ];

  // ── Database & schema ──
  checks.push((async (): Promise<Check> => {
    if (!admin) return { id: "db", group: "Database", name: "Supabase database", status: "fail", detail: "Can't check without the admin key." };
    const r = await timed(async () => admin.from("bills").select("id", { count: "exact", head: true }));
    if (r.error || (r.value as any)?.error) return { id: "db", group: "Database", name: "Supabase database", status: "fail", detail: `Couldn't query: ${r.error ?? (r.value as any).error.message}`, ms: r.ms };
    return { id: "db", group: "Database", name: "Supabase database", status: r.ms > 4000 ? "warn" : "ok", detail: `${((r.value as any).count ?? 0).toLocaleString()} bills cached${r.ms > 4000 ? ". Slow to respond, probably waking from idle (free plan)." : ""}`, ms: r.ms };
  })());

  const schema: { id: string; name: string; table: string; cols: string; file: string; required: boolean }[] = [
    { id: "schema-events", name: "Activity dates (October 2026 update)", table: "bill_events", cols: "action_date,details", file: "supabase/2026-10-activity-and-discovery.sql", required: false },
    { id: "schema-prospective", name: "Discovery suggestions table", table: "prospective_bills", cols: "id", file: "supabase/schema.sql (the prospective_bills section)", required: true },
    { id: "schema-reasons", name: "Why-it-matched notes (October 2026 update)", table: "prospective_bills", cols: "match_reason,match_score", file: "supabase/2026-10-activity-and-discovery.sql", required: false },
    { id: "schema-workspace", name: "Team notes and tasks table", table: "bill_workspace_items", cols: "id,assigned_to,due_date", file: "supabase/add-bill-workspace-table.sql, then supabase/2026-10-activity-and-discovery.sql", required: false },
    { id: "schema-members", name: "Contacts tables", table: "member_positions", cols: "id", file: "supabase/schema.sql (members section), then supabase/add-member-crm-columns.sql", required: false },
    { id: "schema-regs", name: "Regulation suggestions table", table: "prospective_regulations", cols: "id", file: "supabase/add-regulations-tables.sql", required: false },
  ];
  for (const sc of schema) {
    checks.push((async (): Promise<Check> => {
      if (!admin) return { id: sc.id, group: "Database", name: sc.name, status: "skip", detail: "Needs the admin key" };
      const { error } = await admin.from(sc.table).select(sc.cols).limit(1);
      if (!error) return { id: sc.id, group: "Database", name: sc.name, status: "ok", detail: "Installed" };
      return { id: sc.id, group: "Database", name: sc.name, status: sc.required ? "fail" : "warn", detail: "Not installed yet", fix: `Run ${sc.file} in Supabase → SQL Editor.` };
    })());
  }

  // ── Numbered database updates (supabase/migrations) ──
  let migrations: { id: string; name: string; file: string; unlocks: string; appliedAt: string | null }[] = [];
  let runs: (JobRun & { id: number })[] = [];
  if (admin) {
    const { data: applied, error: migError } = await admin.from("schema_migrations").select("id, applied_at");
    const appliedAt = new Map(((migError ? [] : applied) as any[] ?? []).map((r) => [r.id, r.applied_at]));
    const { pending } = migrationStatus(appliedAt.keys());
    migrations = MIGRATIONS.map((m) => ({ ...m, appliedAt: appliedAt.get(m.id) ?? null }));
    if (pending.length === 0) {
      config.push({ id: "migrations", group: "Database updates", name: "All database updates", status: "ok", detail: `All ${MIGRATIONS.length} have been run` });
    } else {
      for (const m of pending) {
        config.push({ id: `migration-${m.id}`, group: "Database updates", name: `${m.id}: ${m.name}`, status: "warn", detail: `Not run yet. Unlocks: ${m.unlocks}`, fix: `Run ${m.file} in Supabase → SQL Editor${pending.length > 1 ? ", in number order" : ""}.` });
      }
    }

    const { data: runRows, error: runError } = await admin.from("job_runs").select("id, job, started_at, finished_at, ok, error, summary").order("started_at", { ascending: false }).limit(14);
    if (!runError) {
      runs = (runRows as any[]) ?? [];
      for (const job of ["poll", "notify"] as const) {
        const problem = assessJob(runs, job, new Date());
        const last = runs.find((r) => r.job === job);
        config.push({
          id: `run-${job}`,
          group: "Scheduled jobs",
          name: `${JOB_LABELS[job]}: last run`,
          status: problem ? "fail" : last ? "ok" : "skip",
          detail: problem ?? (last ? `Finished ${new Date(last.started_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET` : "No runs recorded yet. The first one happens tomorrow morning."),
          fix: problem ? `Open /api/cron/${job}?secret=YOUR_CRON_SECRET to run it by hand and see the error.` : undefined,
        });
      }
    }
  }
  config.push({
    id: "alerts-to",
    group: "Scheduled jobs",
    name: "Who hears about failed runs",
    status: "ok",
    detail: env.ALERT_EMAIL ? `Emails go to ${env.ALERT_EMAIL}` : "Team owners. Set ALERT_EMAIL in Vercel to send these somewhere else.",
  });

  // ── Scheduled jobs ──
  checks.push((async (): Promise<Check> => {
    if (!admin) return { id: "cron-poll", group: "Scheduled jobs", name: "Morning check of congress.gov", status: "skip", detail: "Needs the admin key" };
    const { data: tracked } = await admin.from("tracked_bills").select("bill_id").limit(2000);
    const ids = Array.from(new Set((tracked ?? []).map((t: any) => t.bill_id)));
    if (ids.length === 0) return { id: "cron-poll", group: "Scheduled jobs", name: "Morning check of congress.gov", status: "ok", detail: "No tracked bills yet" };
    const { data: latest } = await admin.from("bills").select("last_polled_at").in("id", ids.slice(0, 200)).order("last_polled_at", { ascending: true, nullsFirst: true }).limit(1);
    const oldest = latest?.[0]?.last_polled_at as string | null | undefined;
    const hours = oldest ? (Date.now() - new Date(oldest).getTime()) / 3_600_000 : Infinity;
    if (hours <= 36) return { id: "cron-poll", group: "Scheduled jobs", name: "Morning check of congress.gov", status: "ok", detail: `All ${ids.length} tracked bills checked in the last ${Math.max(1, Math.round(hours))} hours` };
    return {
      id: "cron-poll", group: "Scheduled jobs", name: "Morning check of congress.gov", status: hours > 72 ? "fail" : "warn",
      detail: oldest ? `At least one tracked bill hasn't been checked in ${Math.round(hours / 24)} days` : "Some tracked bills have never been checked",
      fix: "In Vercel → Settings → Cron Jobs, confirm /api/cron/poll is listed and enabled, then open /api/cron/poll?secret=YOUR_CRON_SECRET to run it by hand.",
    };
  })());

  checks.push((async (): Promise<Check> => {
    if (!admin) return { id: "cron-discover", group: "Scheduled jobs", name: "Topic discovery", status: "skip", detail: "Needs the admin key" };
    const { data, error } = await admin.from("prospective_bills").select("discovered_at").order("discovered_at", { ascending: false }).limit(1);
    if (error) return { id: "cron-discover", group: "Scheduled jobs", name: "Topic discovery", status: "warn", detail: "Suggestions table isn't readable" };
    const last = data?.[0]?.discovered_at;
    return { id: "cron-discover", group: "Scheduled jobs", name: "Topic discovery", status: "ok", detail: last ? `Last new suggestion ${new Date(last).toLocaleDateString()}` : "No suggestions yet. Add topics in Discover." };
  })());

  // ── External data sources ──
  if (env.CONGRESS_API_KEY) {
    checks.push(httpCheck("congress", "Data sources", "congress.gov (bills, votes, members)", `https://api.congress.gov/v3/bill/119?format=json&limit=1&api_key=${env.CONGRESS_API_KEY}`));
  }
  const govKey = env.GOVINFO_API_KEY || env.CONGRESS_API_KEY || "DEMO_KEY";
  checks.push(httpCheck("govinfo", "Data sources", "GovInfo (full-text bill search, Congressional Record)", `https://api.govinfo.gov/search?api_key=${govKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "health collection:BILLS congress:119", pageSize: "1", offsetMark: "*", resultLevel: "package" }),
  }));
  checks.push((async (): Promise<Check> => {
    const r = await timed(() => ldaFetch("https://lda.gov/api/v1/filings/?page_size=1"));
    if (r.error) return { id: "lda", group: "Data sources", name: "LDA.gov (lobbying disclosures)", status: "fail", detail: `Couldn't connect: ${r.error}`, ms: r.ms };
    const res = r.value!;
    if (res.ok) return { id: "lda", group: "Data sources", name: "LDA.gov (lobbying disclosures)", status: "ok", detail: "Responding", ms: r.ms };
    return { id: "lda", group: "Data sources", name: "LDA.gov (lobbying disclosures)", status: res.status === 429 ? "warn" : "fail", detail: res.status === 401 ? "Rejected the LDA API key" : `Returned HTTP ${res.status}`, ms: r.ms, fix: res.status === 401 ? "Check LDA_API_KEY in Vercel, or remove it to use anonymous access." : undefined };
  })());
  checks.push(httpCheck("fedreg", "Data sources", "Federal Register (regulations)", "https://www.federalregister.gov/api/v1/documents.json?per_page=1"));
  checks.push(httpCheck("news", "Data sources", "Google News feed (bill coverage)", "https://news.google.com/rss/search?q=congress&hl=en-US&gl=US&ceid=US:en"));

  // ── Notifications ──
  if (env.RESEND_API_KEY) {
    checks.push((async (): Promise<Check> => {
      const r = await timed((signal) => fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, signal }));
      if (r.error) return { id: "resend", group: "Alerts", name: "Email (Resend)", status: "fail", detail: `Couldn't connect: ${r.error}`, ms: r.ms };
      const res = r.value!;
      if (res.status === 401 || res.status === 403) return { id: "resend", group: "Alerts", name: "Email (Resend)", status: "fail", detail: "Resend rejected the API key", ms: r.ms, fix: "Create a new key in Resend and update RESEND_API_KEY." };
      const body = await res.json().catch(() => ({}));
      const from = env.RESEND_FROM_EMAIL ?? "";
      const fromDomain = from.split("@")[1]?.replace(/>$/, "") ?? "";
      const domains: any[] = body.data ?? [];
      const match = domains.find((d) => d.name && fromDomain.endsWith(d.name));
      if (!from) return { id: "resend", group: "Alerts", name: "Email (Resend)", status: "fail", detail: "RESEND_FROM_EMAIL is missing", ms: r.ms, fix: "Set RESEND_FROM_EMAIL to an address on your verified domain." };
      if (fromDomain === "resend.dev") return { id: "resend", group: "Alerts", name: "Email (Resend)", status: "warn", detail: "Using Resend's test sender, which only delivers to the Resend account owner", ms: r.ms, fix: "Verify a sending domain in Resend (a subdomain like alerts.yourfirm.com) and update RESEND_FROM_EMAIL." };
      if (!match) return { id: "resend", group: "Alerts", name: "Email (Resend)", status: "warn", detail: `The sender domain ${fromDomain} isn't set up in this Resend account`, ms: r.ms, fix: "Add and verify that domain in Resend → Domains." };
      return { id: "resend", group: "Alerts", name: "Email (Resend)", status: match.status === "verified" ? "ok" : "warn", detail: match.status === "verified" ? `Sending from ${from}` : `Domain ${match.name} is "${match.status}", not verified yet`, ms: r.ms };
    })());
  } else {
    config.push({ id: "resend", group: "Alerts", name: "Email (Resend)", status: "skip", detail: "Not set up. Email alerts are off for everyone.", fix: "Add RESEND_API_KEY and RESEND_FROM_EMAIL in Vercel to turn on email." });
  }

  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    checks.push((async (): Promise<Check> => {
      const c = await httpCheck("twilio", "Alerts", "Text messages (Twilio)", `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}` },
      }, "Account credentials work");
      if (c.status === "ok" && !env.TWILIO_FROM_NUMBER) return { ...c, status: "warn", detail: "Credentials work, but TWILIO_FROM_NUMBER is missing", fix: "Add TWILIO_FROM_NUMBER in Vercel." };
      return c;
    })());
  } else {
    config.push({ id: "twilio", group: "Alerts", name: "Text messages (Twilio)", status: "skip", detail: "Not set up. Text alerts are off." });
  }

  const results = [...config, ...(await Promise.all(checks))];
  const summary = {
    ok: results.filter((r) => r.status === "ok").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
  };
  return NextResponse.json({ checkedAt: new Date().toISOString(), summary, results, migrations, runs });
}

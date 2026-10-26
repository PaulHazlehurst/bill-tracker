// SERVER-ONLY. A log of every scheduled run, and an email when one fails.
//
// The two daily jobs watch each other: the alert run (6:15 UTC) checks that
// this morning's congress.gov check (6:00 UTC) ran and finished, and the
// morning check looks at how yesterday's alert run went. If either one
// failed, stopped partway, or didn't run at all, whoever gets failure alerts
// hears about it once, instead of finding out days later from stale data.
//
// Everything here is best-effort: if the job_runs table doesn't exist yet
// (migration 0001 not run) the jobs carry on exactly as before.

import { Resend } from "resend";

type Admin = any;

export type JobName = "poll" | "notify";

export type JobRun = {
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  error: string | null;
  summary?: Record<string, unknown> | null;
};

export const JOB_LABELS: Record<JobName, string> = {
  poll: "Morning check of congress.gov",
  notify: "Alerts, discovery and reports",
};

/** Records the start of a run. Returns the row id, or null if logging isn't set up. */
export async function startJobRun(admin: Admin, job: JobName): Promise<number | null> {
  try {
    const { data, error } = await admin.from("job_runs").insert({ job }).select("id").single();
    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
}

export async function finishJobRun(admin: Admin, id: number | null, outcome: { ok: boolean; summary?: Record<string, unknown>; error?: string | null }) {
  if (id == null) return;
  try {
    await admin
      .from("job_runs")
      .update({ finished_at: new Date().toISOString(), ok: outcome.ok, summary: outcome.summary ?? null, error: outcome.error ?? null })
      .eq("id", id);
  } catch {
    // Logging must never break the job itself.
  }
}

/**
 * Looks at a job's recent runs and says what's wrong, if anything.
 * Pure, so it can be tested without a database.
 */
export function assessJob(runs: JobRun[], job: JobName, now: Date, opts: { maxAgeHours?: number; stuckMinutes?: number } = {}): string | null {
  const maxAgeHours = opts.maxAgeHours ?? 26;
  const stuckMinutes = opts.stuckMinutes ?? 10;
  const mine = runs.filter((r) => r.job === job).sort((a, b) => b.started_at.localeCompare(a.started_at));
  // No history at all means logging was only just switched on. Nothing to judge yet.
  if (mine.length === 0) return null;
  const last = mine[0];
  const label = JOB_LABELS[job];
  const ageHours = (now.getTime() - new Date(last.started_at).getTime()) / 3_600_000;
  if (ageHours > maxAgeHours) {
    return `${label} hasn't run since ${formatWhen(last.started_at)}. Vercel may have paused the scheduled job.`;
  }
  if (!last.finished_at) {
    const ageMinutes = ageHours * 60;
    if (ageMinutes > stuckMinutes) return `${label} started at ${formatWhen(last.started_at)} but never finished. It probably crashed or ran out of time.`;
    return null;
  }
  if (last.ok === false) {
    return `${label} failed at ${formatWhen(last.started_at)}: ${last.error ?? "no error message was recorded"}.`;
  }
  return null;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
}

/** Who gets failure alerts: ALERT_EMAIL if set (comma-separated), otherwise every team owner. */
export async function alertRecipients(admin: Admin): Promise<string[]> {
  const fromEnv = (process.env.ALERT_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /.+@.+\..+/.test(s));
  if (fromEnv.length) return fromEnv;
  try {
    const { data: orgs } = await admin.from("organizations").select("created_by").not("created_by", "is", null);
    const ids = Array.from(new Set(((orgs as any[]) ?? []).map((o) => o.created_by)));
    if (!ids.length) return [];
    const { data: profiles } = await admin.from("profiles").select("email").in("id", ids);
    return Array.from(new Set(((profiles as any[]) ?? []).map((p) => p.email).filter(Boolean)));
  } catch {
    return [];
  }
}

/**
 * Checks another job's latest run and emails the alert recipients if
 * something is wrong. At most one email per job per 20 hours.
 */
export async function checkAndAlert(admin: Admin, watched: JobName): Promise<{ problem: string | null; alerted: boolean }> {
  let runs: JobRun[] = [];
  try {
    const { data, error } = await admin
      .from("job_runs")
      .select("job, started_at, finished_at, ok, error")
      .eq("job", watched)
      .order("started_at", { ascending: false })
      .limit(3);
    if (error) return { problem: null, alerted: false };
    runs = (data as JobRun[]) ?? [];
  } catch {
    return { problem: null, alerted: false };
  }

  const problem = assessJob(runs, watched, new Date());
  if (!problem) return { problem: null, alerted: false };
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return { problem, alerted: false };

  const key = `alert:${watched}`;
  const { data: state } = await admin.from("sync_state").select("last_run_at").eq("key", key).maybeSingle();
  if (state?.last_run_at && Date.now() - new Date(state.last_run_at).getTime() < 20 * 3_600_000) return { problem, alerted: false };

  const to = await alertRecipients(admin);
  if (!to.length) return { problem, alerted: false };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to,
      subject: `Bill Tracker: ${JOB_LABELS[watched].toLowerCase()} needs attention`,
      text: `${problem}\n\nThe Data sources page shows the last few runs and tests every connection:\n${appUrl}/api-usage\n\nTo run it again by hand, open ${appUrl}/api/cron/${watched}?secret=YOUR_CRON_SECRET`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#0e1530"><p style="font-size:16px;font-weight:600">${escapeHtml(problem)}</p><p style="font-size:14px">The <a href="${appUrl}/api-usage">Data sources page</a> shows the last few runs and tests every connection.</p><p style="font-size:13px;color:#5b6478">To run it again by hand, open ${escapeHtml(appUrl)}/api/cron/${watched}?secret=YOUR_CRON_SECRET</p></div>`,
    });
    if (error) throw new Error(error.message);
    await admin.from("sync_state").upsert({ key, last_run_at: new Date().toISOString() });
    return { problem, alerted: true };
  } catch (err) {
    console.error("job alert failed", err);
    return { problem, alerted: false };
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

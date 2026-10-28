import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { mapLimit, deadline, chunk } from "@/lib/batch";
import { computeRefresh, insertEventsSafe, writeBillRows, nextPollAt, REFRESH_COLUMNS, type StoredBill, type NewEvent } from "@/lib/billRefresh";
import { startJobRun, finishJobRun, checkAndAlert } from "@/lib/jobLog";
import { syncWeekAhead } from "@/lib/meetings";
import { syncDrugBoards } from "@/lib/drugBoardsSync";

// 60s is the Hobby-plan ceiling. Without an explicit value Vercel applies a
// short default and kills the job partway through.
export const maxDuration = 60;

// Stop a little before the platform limit so a run always ends on a clean write.
const BUDGET_MS = 48_000;
const CONCURRENCY = 8;
const WRITE_CHUNK = 40;
// Tracked bills are checked every run. Bills nobody tracks (discovery
// suggestions, bills someone only opened) are refreshed weekly at most and
// capped per run, so they can never crowd out the bills people care about -
// previously every suggestion ever made was polled alongside tracked bills
// in the same 200-bill window.
const MAX_UNTRACKED_PER_RUN = 30;
const TRACKED_RECHECK_HOURS = 18;

export async function GET(req: NextRequest) {
  // Vercel Cron sends the Authorization header. ?secret= exists so the job
  // can also be triggered by pasting a URL into a browser for testing.
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const authorized = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const clock = deadline(BUDGET_MS);
  const admin = createAdminClient();
  const runId = await startJobRun(admin, "poll");

  try {
    const summary = await runPoll(admin, clock);
    await finishJobRun(admin, runId, { ok: true, summary });
    return NextResponse.json(summary);
  } catch (err: any) {
    const message = String(err?.message ?? err);
    console.error("poll: run failed", err);
    await finishJobRun(admin, runId, { ok: false, error: message });
    return NextResponse.json({ error: "poll failed", detail: message }, { status: 500 });
  }
}

async function runPoll(admin: ReturnType<typeof createAdminClient>, clock: ReturnType<typeof deadline>) {
  // 1. Which bills does anyone actually track?
  const { data: trackedRows, error: trackedError } = await admin.from("tracked_bills").select("bill_id");
  if (trackedError) throw new Error(`couldn't load tracked bills: ${trackedError.message}`);
  const trackedIds = Array.from(new Set((trackedRows ?? []).map((r: any) => r.bill_id as string)));
  const trackedSet = new Set(trackedIds);

  // 2. Tracked bills not checked in the last ~day, least-recently-checked first.
  const cutoff = new Date(Date.now() - TRACKED_RECHECK_HOURS * 3_600_000).toISOString();
  const trackedDue: (StoredBill & { last_polled_at: string | null })[] = [];
  for (const ids of chunk(trackedIds, 100)) {
    const { data, error } = await admin
      .from("bills")
      .select(`${REFRESH_COLUMNS}, last_polled_at`)
      .in("id", ids)
      .or(`last_polled_at.is.null,last_polled_at.lt."${cutoff}"`);
    if (error) console.error("poll: tracked bill load failed", error);
    trackedDue.push(...((data as any[]) ?? []));
  }
  trackedDue.sort((a, b) => String(a.last_polled_at ?? "").localeCompare(String(b.last_polled_at ?? "")));

  // 3. A few untracked bills whose weekly refresh is due.
  const { data: untrackedData } = await admin
    .from("bills")
    .select(REFRESH_COLUMNS)
    .lte("next_poll_at", new Date().toISOString())
    .order("next_poll_at", { ascending: true })
    .limit(MAX_UNTRACKED_PER_RUN * 3);
  const untrackedDue = ((untrackedData as StoredBill[]) ?? []).filter((b) => !trackedSet.has(b.id)).slice(0, MAX_UNTRACKED_PER_RUN);

  const queue: StoredBill[] = [...trackedDue, ...untrackedDue];
  let polled = 0;
  let changed = 0;
  let failed = 0;
  let eventsWritten = 0;
  let timedOut = false;
  const errors: string[] = [];

  for (const group of chunk(queue, WRITE_CHUNK)) {
    if (clock.expired()) {
      timedOut = true;
      break;
    }
    const outcomes = await mapLimit(group, CONCURRENCY, (bill) => computeRefresh(bill));

    const rows: Record<string, unknown>[] = [];
    const events: NewEvent[] = [];
    for (const o of outcomes) {
      if (!o.ok || !o.row) {
        failed++;
        if (errors.length < 5 && o.error) errors.push(`${o.id}: ${o.error}`);
        continue;
      }
      polled++;
      if (o.changed) changed++;
      const tracked = trackedSet.has(o.id);
      rows.push({ ...o.row, next_poll_at: nextPollAt(String(o.row.status_stage), tracked), poll_priority: tracked ? "normal" : "dormant" });
      // Events for bills nobody tracks aren't news to anyone - skip them.
      if (tracked) events.push(...o.events);
    }

    await writeBillRows(admin, rows);
    const { error: eventError } = await insertEventsSafe(admin, events);
    if (eventError) console.error("poll: event insert failed", eventError);
    else eventsWritten += events.length;
  }

  // Committee meetings and the House floor schedule for Week ahead get
  // whatever time is left. The page also refreshes them when opened, so a
  // busy morning that leaves no time here costs nothing.
  // Leaves ~12 seconds for the drug board check below.
  let weekAhead: Awaited<ReturnType<typeof syncWeekAhead>> | null = null;
  if (clock.remainingMs() > 20_000) {
    try {
      weekAhead = await syncWeekAhead(admin, clock.remainingMs() - 14_000);
    } catch (err) {
      console.error("poll: week-ahead sync failed", err);
    }
  }

  // State drug affordability boards: new documents on their sites, and state
  // bills about them. The Drug boards page can also run this on demand.
  let drugBoards: Awaited<ReturnType<typeof syncDrugBoards>> | null = null;
  if (clock.remainingMs() > 6_000) {
    try {
      drugBoards = await syncDrugBoards(admin, clock.remainingMs() - 2_000);
    } catch (err) {
      console.error("poll: drug board sync failed", err);
    }
  }

  // Did yesterday's alert run go through? (It checks on this run in turn.)
  const watchdog = await checkAndAlert(admin, "notify").catch(() => null);

  // Topic discovery runs in the notify cron, which has its own time budget.
  return {
    tracked: trackedIds.length,
    trackedDue: trackedDue.length,
    untrackedDue: untrackedDue.length,
    polled,
    changed,
    eventsWritten,
    failed,
    // Anything that didn't fit stays due and is picked up first next run.
    deferred: queue.length - polled - failed,
    timedOut,
    errors,
    weekAhead,
    drugBoards,
    watchdog,
    ms: clock.elapsedMs(),
  };
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { mapLimit, deadline, chunk } from "@/lib/batch";
import { computeRefresh, insertEventsSafe, writeBillRows, nextPollAt, REFRESH_COLUMNS, type StoredBill, type NewEvent } from "@/lib/billRefresh";

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

  // 1. Which bills does anyone actually track?
  const { data: trackedRows, error: trackedError } = await admin.from("tracked_bills").select("bill_id");
  if (trackedError) {
    console.error("poll: failed to load tracked bills", trackedError);
    return NextResponse.json({ error: "db error", detail: trackedError.message }, { status: 500 });
  }
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

  // Topic discovery runs in the notify cron, which has its own time budget.
  return NextResponse.json({
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
    ms: clock.elapsedMs(),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getBill, inferStage, progressForStage } from "@/lib/congress-api";
import { mapLimit, deadline, chunk } from "@/lib/batch";

// Give this function room to work. Without an explicit value Vercel applies
// its short default (10s), which this job blew through every single run -
// meaning it was being killed partway through, and anything scheduled after
// the polling loop never executed at all. 60s is the Hobby-plan ceiling.
export const maxDuration = 60;

// Stop cleanly a little before the platform's limit, so the run always ends
// on a clean write rather than being cut off mid-request.
const BUDGET_MS = 45_000;

// How many bills to fetch from congress.gov at once. The whole job used to
// be strictly sequential - one bill, wait, next bill - so 200 bills meant
// 200 round-trips back to back. Eight at a time turns ~80s of waiting into
// ~8s while staying far below congress.gov's 5,000/hr allowance.
const CONCURRENCY = 8;

// How many bills to fetch before pausing to write results to the database.
// Results are written in bulk per chunk instead of one UPDATE per bill.
const WRITE_CHUNK = 40;

// Poll interval per priority tier, in minutes.
const TIER_INTERVAL_MIN: Record<string, number> = {
  hot: 30,
  normal: 120,
  dormant: 1440, // once a day
};

const TERMINAL_STAGES = new Set(["enacted", "vetoed", "failed"]);

type DueBill = {
  id: string;
  congress: number;
  bill_type: string;
  bill_number: number;
  title: string;
  latest_action: string | null;
  status_stage: string;
  poll_priority: string | null;
  raw_snapshot: any;
};

export async function GET(req: NextRequest) {
  // Reject anyone who isn't Vercel Cron. Without this, hitting this URL
  // directly would let a stranger trigger congress.gov calls on your key.
  // Vercel's own Cron scheduler sends this header automatically - that's
  // the normal path. The ?secret= query param is only here so you can also
  // trigger this by pasting a URL into your browser's address bar, for
  // manual testing without a terminal.
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const authorized =
    auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET;
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const clock = deadline(BUDGET_MS);
  const supabase = createAdminClient();

  // Only the columns this job actually reads. It used to select("*"), which
  // dragged every large cached JSONB column (summaries, hearing details,
  // news, text versions…) across the wire for 200 bills on every run, none
  // of which polling looks at. raw_snapshot IS needed - the cosponsor count
  // is compared against it.
  const { data: dueBills, error } = await supabase
    .from("bills")
    .select("id, congress, bill_type, bill_number, title, latest_action, status_stage, poll_priority, raw_snapshot")
    .lte("next_poll_at", new Date().toISOString())
    .order("next_poll_at", { ascending: true }) // oldest-due first, so nothing starves
    .limit(200);

  if (error) {
    console.error("failed to load due bills", error);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }

  const bills = (dueBills as DueBill[]) ?? [];
  let polled = 0;
  let changed = 0;
  let failed = 0;
  let timedOut = false;

  for (const group of chunk(bills, WRITE_CHUNK)) {
    if (clock.expired()) {
      timedOut = true;
      break;
    }

    // ---- Phase 1: fetch this chunk from congress.gov, concurrently ----
    const fetched = await mapLimit(group, CONCURRENCY, async (bill) => {
      try {
        const raw = await getBill(bill.congress, bill.bill_type, bill.bill_number);
        return { bill, b: raw.bill as any, ok: true as const };
      } catch (err) {
        console.error(`poll failed for ${bill.id}`, err);
        return { bill, b: null, ok: false as const };
      }
    });

    // ---- Phase 2: turn those into rows, then write them in bulk ----
    const now = new Date().toISOString();
    const billRows: any[] = [];
    const events: any[] = [];

    for (const r of fetched) {
      if (!r.ok || !r.b) {
        failed++;
        continue;
      }
      polled++;
      const { bill, b } = r;

      const latestActionText = b.latestAction?.text ?? "";
      const stage = inferStage(latestActionText);
      const progress = progressForStage(stage);
      const isDifferent = latestActionText !== bill.latest_action || stage !== bill.status_stage;

      // Cosponsor count is already sitting in this same response - we don't
      // need a second API call to compare it against last time.
      const oldCosponsors = bill.raw_snapshot?.cosponsors?.count ?? null;
      const newCosponsors = b.cosponsors?.count ?? null;
      const cosponsorsChanged =
        oldCosponsors !== null && newCosponsors !== null && newCosponsors !== oldCosponsors;

      const nextTier = TERMINAL_STAGES.has(stage) ? "dormant" : bill.poll_priority || "normal";
      const nextPollAt = new Date(Date.now() + TIER_INTERVAL_MIN[nextTier] * 60_000).toISOString();

      // Upsert rather than update, so the whole chunk is one statement.
      // The NOT NULL columns (congress, bill_type, bill_number, title) are
      // included deliberately: the row always already exists so this takes
      // the ON CONFLICT UPDATE path, but including them keeps the statement
      // valid either way.
      billRows.push({
        id: bill.id,
        congress: bill.congress,
        bill_type: bill.bill_type,
        bill_number: bill.bill_number,
        title: b.title ?? bill.title,
        latest_action: latestActionText,
        latest_action_date: b.latestAction?.actionDate ?? null,
        status_stage: stage,
        progress_pct: progress,
        raw_snapshot: b,
        last_polled_at: now,
        next_poll_at: nextPollAt,
        poll_priority: nextTier,
      });

      if (isDifferent) {
        changed++;
        events.push({
          bill_id: bill.id,
          event_type: stage !== bill.status_stage ? "status_change" : "new_action",
          summary: latestActionText || "Status updated",
        });
      }

      if (cosponsorsChanged) {
        changed++;
        const delta = newCosponsors - oldCosponsors;
        events.push({
          bill_id: bill.id,
          event_type: "cosponsor_change",
          summary: `Cosponsor count ${delta > 0 ? "increased" : "decreased"} from ${oldCosponsors} to ${newCosponsors}`,
          cosponsor_delta: delta,
        });
      }
    }

    if (billRows.length > 0) {
      const { error: upsertError } = await supabase
        .from("bills")
        .upsert(billRows, { onConflict: "id" });

      if (upsertError) {
        // Safety net. Polling is the single most important thing this app
        // does, so if the bulk write fails for any reason (an unexpected
        // constraint, a column added later that this payload doesn't know
        // about), fall back to writing the rows one at a time rather than
        // silently losing a whole chunk of updates. Slower, but correct.
        console.error("bulk bill upsert failed, falling back to per-row updates", upsertError);
        await mapLimit(billRows, 4, async (row) => {
          const { id, ...fields } = row;
          const { error: rowError } = await supabase.from("bills").update(fields).eq("id", id);
          if (rowError) console.error(`row update failed for ${id}`, rowError);
        });
      }
    }
    if (events.length > 0) {
      const { error: eventError } = await supabase.from("bill_events").insert(events);
      if (eventError) console.error("bulk event insert failed", eventError);
    }
  }

  // NOTE: topic discovery used to run here, at the end of this same
  // function. That was the bug - polling consumed the entire time budget
  // first, so discovery was reached late or not at all, which is why
  // suggestions only ever appeared when someone pressed "Check now"
  // manually. It now runs in the notify cron (see app/api/cron/notify),
  // which is cheap since its queries were batched, and it gets its own
  // time budget there instead of competing with polling for this one.

  return NextResponse.json({
    polled,
    changed,
    failed,
    due: bills.length,
    // Bills that were due but didn't fit in this run stay due and are picked
    // up by the next one - nothing is lost, it just takes another cycle.
    deferred: timedOut ? bills.length - polled - failed : 0,
    timedOut,
    ms: clock.elapsedMs(),
  });
}

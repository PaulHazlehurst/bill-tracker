import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getBill, inferStage, progressForStage } from "@/lib/congress-api";

// Poll interval per priority tier, in minutes.
const TIER_INTERVAL_MIN: Record<string, number> = {
  hot: 30,
  normal: 120,
  dormant: 1440, // once a day
};

const TERMINAL_STAGES = new Set(["enacted", "vetoed", "failed"]);

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

  const supabase = createAdminClient();

  // Only fetch bills that are actually due, deduped by definition since
  // `bills` has one row per unique bill regardless of how many users track it.
  const { data: dueBills, error } = await supabase
    .from("bills")
    .select("*")
    .lte("next_poll_at", new Date().toISOString())
    .limit(200); // hard ceiling per run — protects the hourly budget

  if (error) {
    console.error("failed to load due bills", error);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }

  let changed = 0;
  let polled = 0;

  for (const bill of dueBills ?? []) {
    polled++;
    try {
      const raw = await getBill(bill.congress, bill.bill_type, bill.bill_number);
      const b = raw.bill;
      const latestActionText = b.latestAction?.text ?? "";
      const stage = inferStage(latestActionText);
      const progress = progressForStage(stage);

      const isDifferent = latestActionText !== bill.latest_action || stage !== bill.status_stage;

      // Cosponsor count is already sitting in this same response - we don't
      // need a second API call to compare it against last time. This is
      // what makes the activity feed richer without costing any extra quota.
      const oldCosponsors = bill.raw_snapshot?.cosponsors?.count ?? null;
      const newCosponsors = b.cosponsors?.count ?? null;
      const cosponsorsChanged = oldCosponsors !== null && newCosponsors !== null && newCosponsors !== oldCosponsors;

      const nextTier = TERMINAL_STAGES.has(stage) ? "dormant" : bill.poll_priority || "normal";
      const nextPollAt = new Date(Date.now() + TIER_INTERVAL_MIN[nextTier] * 60_000).toISOString();

      await supabase
        .from("bills")
        .update({
          latest_action: latestActionText,
          latest_action_date: b.latestAction?.actionDate ?? null,
          status_stage: stage,
          progress_pct: progress,
          raw_snapshot: b,
          last_polled_at: new Date().toISOString(),
          next_poll_at: nextPollAt,
          poll_priority: nextTier,
        })
        .eq("id", bill.id);

      if (isDifferent) {
        changed++;
        await supabase.from("bill_events").insert({
          bill_id: bill.id,
          event_type: stage !== bill.status_stage ? "status_change" : "new_action",
          summary: latestActionText || "Status updated",
        });
      }

      if (cosponsorsChanged) {
        changed++;
        const delta = newCosponsors - oldCosponsors;
        await supabase.from("bill_events").insert({
          bill_id: bill.id,
          event_type: "cosponsor_change",
          summary: `Cosponsor count ${delta > 0 ? "increased" : "decreased"} from ${oldCosponsors} to ${newCosponsors}`,
          cosponsor_delta: delta,
        });
      }
    } catch (err) {
      console.error(`poll failed for ${bill.id}`, err);
      // don't let one bad bill stall the whole run; it'll retry next cycle
    }
  }

  return NextResponse.json({ polled, changed });
}

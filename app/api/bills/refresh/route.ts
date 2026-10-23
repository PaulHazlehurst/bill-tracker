import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { computeRefresh, insertEventsSafe, writeBillRows, nextPollAt, REFRESH_COLUMNS } from "@/lib/billRefresh";

export const maxDuration = 30;

// A bill can be re-checked on demand at most this often, so a busy team
// clicking "Check now" can't burn through the congress.gov quota.
const MIN_INTERVAL_MS = 10 * 60_000;

// POST { billId } - re-check one bill against congress.gov right now,
// instead of waiting for tomorrow morning's automatic check.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { billId } = await req.json().catch(() => ({}));
  if (!billId || typeof billId !== "string") return NextResponse.json({ error: "missing billId" }, { status: 400 });

  // Bills are only writable by the server, so the write goes through the
  // admin client - but only for a bill id that already exists.
  const admin = createAdminClient();
  const { data: bill, error } = await admin.from("bills").select(`${REFRESH_COLUMNS}, last_polled_at`).eq("id", billId).maybeSingle();
  if (error || !bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

  const last = (bill as any).last_polled_at ? new Date((bill as any).last_polled_at).getTime() : 0;
  if (Date.now() - last < MIN_INTERVAL_MS) {
    return NextResponse.json({ ok: true, skipped: true, lastPolledAt: (bill as any).last_polled_at, events: 0 });
  }

  const outcome = await computeRefresh(bill as any, { forceActions: true });
  if (!outcome.ok || !outcome.row) {
    return NextResponse.json({ error: "Couldn't reach congress.gov just now. Try again in a minute." }, { status: 502 });
  }

  const { count } = await admin.from("tracked_bills").select("id", { count: "exact", head: true }).eq("bill_id", billId);
  const tracked = (count ?? 0) > 0;
  await writeBillRows(admin, [{ ...outcome.row, next_poll_at: nextPollAt(String(outcome.row.status_stage), tracked) }]);
  if (tracked) await insertEventsSafe(admin, outcome.events);

  return NextResponse.json({
    ok: true,
    skipped: false,
    events: tracked ? outcome.events.length : 0,
    stage: outcome.row.status_stage,
    lastPolledAt: outcome.row.last_polled_at,
  });
}

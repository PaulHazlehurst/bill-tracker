import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// GET - genuinely public, no auth check on purpose. This is what powers
// the /share/bill/[id] page, for sending a bill's profile to someone
// outside the app.
//
// IMPORTANT BOUNDARY: this returns ONLY data from the `bills` table, which
// is already public congress.gov data with nothing sensitive in it. It
// must NEVER read from `tracked_bills` - that table holds a specific
// person's or team's private position, notes, and notification settings,
// and none of that belongs on a page anyone with the link can view.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const admin = createAdminClient();

  const { data: bill, error } = await admin
    .from("bills")
    .select("id, title, bill_type, bill_number, congress, status_stage, progress_pct, latest_action, latest_action_date, congress_url, raw_snapshot, summaries")
    .eq("id", id)
    .single();

  if (error || !bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  return NextResponse.json({ bill });
}

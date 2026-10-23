import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchBillsRanked, RESOLUTION_TYPES } from "@/lib/congress-api";

export const maxDuration = 30;

// GET ?topic=... - "what would this topic find?" Runs the same ranked search
// discovery uses, WITHOUT saving anything, and marks which results are
// already tracked or suggested. Lets someone test a keyword before adding it,
// and see why each bill matched.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const topic = (req.nextUrl.searchParams.get("topic") ?? "").trim();
  if (topic.length < 2) return NextResponse.json({ error: "Type at least two letters." }, { status: 400 });

  try {
    const { results, failed, passes } = await searchBillsRanked(topic, { recentPages: 2, limit: 40 });
    // RLS scopes both of these to this person (and their team).
    const [{ data: tracked }, { data: suggested }] = await Promise.all([
      supabase.from("tracked_bills").select("bill_id"),
      supabase.from("prospective_bills").select("bill_id"),
    ]);
    const trackedSet = new Set((tracked ?? []).map((r) => r.bill_id));
    const suggestedSet = new Set((suggested ?? []).map((r) => r.bill_id));

    const bills = results
      .filter((r) => !RESOLUTION_TYPES.has(r.type.toLowerCase()))
      .map((r) => {
        const id = `${r.type.toLowerCase()}-${r.number}-${r.congress}`;
        return { ...r, id, status: trackedSet.has(id) ? "tracked" : suggestedSet.has(id) ? "suggested" : "new" };
      });
    return NextResponse.json({ topic, bills, total: bills.length, partial: failed.length > 0 && failed.length < passes });
  } catch (err) {
    console.error("topic preview failed", err);
    return NextResponse.json({ error: "Search is unavailable right now. Try again in a minute." }, { status: 502 });
  }
}

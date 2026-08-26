import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/briefing — returns all data needed for the stakeholder briefing
// page in one payload. No new database tables, no new API calls — everything
// is already stored (tracked_bills + bills + bill_events).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, organizations(name)")
    .eq("id", user.id)
    .single();

  const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;

  const { data: rows } = await supabase
    .from("tracked_bills")
    .select("bill_id, position, bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url, raw_snapshot, last_polled_at)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Recent events across all tracked bills (last 30 days)
  const billIds = Array.from(new Set((rows ?? []).map((r) => r.bill_id)));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: events } = billIds.length > 0
    ? await supabase
        .from("bill_events")
        .select("bill_id, event_type, summary, occurred_at")
        .in("bill_id", billIds)
        .gte("occurred_at", thirtyDaysAgo)
        .order("occurred_at", { ascending: false })
        .limit(50)
    : { data: [] };

  return NextResponse.json({
    orgName: (org as any)?.name ?? null,
    userEmail: user.email,
    generatedAt: new Date().toISOString(),
    bills: rows ?? [],
    recentEvents: events ?? [],
  });
}

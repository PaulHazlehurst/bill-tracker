import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildInsights, MOVING_DAYS } from "@/lib/insights";

export const maxDuration = 30;

// GET /api/insights?scope=mine|team
// Everything the Insights page shows, from data already stored (no outside
// calls). "team" reads every teammate's tracked bills; row-level security
// keeps it to the caller's own team.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope") === "team" ? "team" : "mine";
  let q = supabase.from("tracked_bills").select("bill_id, position, user_id");
  if (scope === "mine") q = q.eq("user_id", user.id);
  const { data: trackers, error } = await q;
  if (error) return NextResponse.json({ error: "Couldn't read the bills you follow." }, { status: 500 });

  const ids = Array.from(new Set((trackers ?? []).map((t) => t.bill_id)));
  if (!ids.length) return NextResponse.json({ scope, insights: null });

  const since = new Date(Date.now() - 12 * 7 * 86_400_000).toISOString();
  const [bills, events, links] = await Promise.all([
    supabase.from("bills").select("id, title, status_stage, latest_action, latest_action_date, cosponsor_breakdown").in("id", ids),
    supabase.from("bill_events").select("bill_id, occurred_at, event_type").in("bill_id", ids).gte("occurred_at", since).limit(5000),
    supabase.from("client_bills").select("client_id, bill_id, position, clients(name)").in("bill_id", ids),
  ]);

  const insights = buildInsights({
    trackers: trackers ?? [],
    bills: (bills.data as any[]) ?? [],
    events: (events.data as any[]) ?? [],
    clients: ((links.data as any[]) ?? []).map((l) => ({
      client_id: l.client_id,
      bill_id: l.bill_id,
      position: l.position,
      client_name: (Array.isArray(l.clients) ? l.clients[0]?.name : l.clients?.name) ?? "Client",
    })),
  });
  return NextResponse.json({ scope, movingDays: MOVING_DAYS, insights });
}

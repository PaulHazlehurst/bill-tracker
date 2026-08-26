import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/impact — cross-bill impact dashboard data
// Groups tracked bills by policy area, computes portfolio health metrics,
// and identifies advancing vs stalled legislation. All from data we
// already store — no extra API calls.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: tracked } = await supabase
    .from("tracked_bills")
    .select("bill_id, position, bills(title, status_stage, progress_pct, latest_action, latest_action_date, raw_snapshot, last_polled_at)")
    .eq("user_id", user.id);

  if (!tracked || tracked.length === 0) {
    return NextResponse.json({ bills: [], groups: [], health: null });
  }

  // Normalize the joined bills (Supabase returns array or object)
  const bills = tracked.map((row: any) => {
    const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
    if (!bill) return null;
    const raw = bill.raw_snapshot;
    const policyArea = raw?.policyArea?.name ?? "Uncategorized";
    const sponsor = raw?.sponsors?.[0];

    return {
      billId: row.bill_id,
      title: bill.title,
      statusStage: bill.status_stage ?? "introduced",
      progressPct: bill.progress_pct ?? 0,
      position: row.position ?? "none",
      policyArea,
      latestAction: bill.latest_action,
      latestActionDate: bill.latest_action_date,
      sponsorName: sponsor?.fullName ?? null,
      sponsorParty: sponsor?.party ?? null,
      cosponsorCount: raw?.cosponsors?.count ?? 0,
    };
  }).filter(Boolean);

  // Group by policy area
  const groupMap = new Map<string, typeof bills>();
  for (const b of bills) {
    const area = b.policyArea;
    if (!groupMap.has(area)) groupMap.set(area, []);
    groupMap.get(area)!.push(b);
  }

  const groups = Array.from(groupMap.entries())
    .map(([area, areaBills]) => ({
      policyArea: area,
      count: areaBills.length,
      avgProgress: Math.round(areaBills.reduce((s: number, b: any) => s + b.progressPct, 0) / areaBills.length),
      bills: areaBills,
    }))
    .sort((a, b) => b.count - a.count);

  // Portfolio health scoring
  const ADVANCING_STAGES = new Set(["passed_house", "passed_senate", "to_president", "enacted"]);
  const STALLED_THRESHOLD = 30; // days without action = stalled

  const now = Date.now();
  let advancingCount = 0;
  let stalledCount = 0;
  let activeCount = 0;

  for (const b of bills) {
    if (ADVANCING_STAGES.has(b.statusStage) || b.statusStage === "enacted") {
      advancingCount++;
    } else if (b.latestActionDate) {
      const daysSinceAction = (now - new Date(b.latestActionDate).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceAction > STALLED_THRESHOLD) {
        stalledCount++;
      } else {
        activeCount++;
      }
    } else {
      stalledCount++;
    }
  }

  // Health score: 0–100 based on movement
  const totalBills = bills.length;
  const healthScore = totalBills > 0
    ? Math.round(((advancingCount * 1.0 + activeCount * 0.6) / totalBills) * 100)
    : 0;

  // Get recent events count for context
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const billIds = bills.map((b: any) => b.billId);
  const { count: recentEventCount } = await supabase
    .from("bill_events")
    .select("id", { count: "exact", head: true })
    .in("bill_id", billIds)
    .gte("occurred_at", thirtyDaysAgo);

  return NextResponse.json({
    bills,
    groups,
    health: {
      score: healthScore,
      advancing: advancingCount,
      active: activeCount,
      stalled: stalledCount,
      total: totalBills,
      recentEvents: recentEventCount ?? 0,
    },
  });
}

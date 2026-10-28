import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { loadWeekView, loadDeadlines, loadBoardItems } from "@/lib/weekData";
import { weekMonday, addDays } from "@/lib/houseFloor";
import { weekHeadline } from "@/lib/weekAhead";
import { lastMeetingSync, STALE_AFTER_MS } from "@/lib/meetings";

export const dynamic = "force-dynamic";

// GET ?start=YYYY-MM-DD&scope=mine|all
// The week's committee meetings, House floor items and comment deadlines,
// marked with why each one matters to you. Reads only our own copy of the
// schedule, so it's fast; `stale: true` tells the page to ask for a refresh.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rawStart = req.nextUrl.searchParams.get("start");
  const start = rawStart && /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? weekMonday(new Date(`${rawStart}T12:00:00Z`)) : weekMonday();
  const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "mine";

  const { ctx, view, meetingsReady, floor } = await loadWeekView(supabase, user.id, start, scope);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const deadlines = await loadDeadlines(supabase, ctx, user.id, today);
  const boardItems = await loadBoardItems(supabase, start, addDays(start, 6));

  // Titles and stages for every bill on the page (floor items and meetings
  // only carry bill numbers).
  const billIds = Array.from(new Set([...view.days.flatMap((d) => d.events.flatMap((e) => e.bills.map((b) => b.billId))), ...view.floor.map((f) => f.billId).filter(Boolean)])) as string[];
  const bills: Record<string, { title: string; stage: string; type: string }> = {};
  if (billIds.length) {
    const { data } = await supabase.from("bills").select("id, title, status_stage, bill_type").in("id", billIds.slice(0, 300));
    for (const b of (data as any[]) ?? []) bills[b.id] = { title: b.title, stage: b.status_stage, type: b.bill_type };
  }

  let lastSync: string | null = null;
  try {
    lastSync = process.env.SUPABASE_SERVICE_ROLE_KEY ? await lastMeetingSync(createAdminClient()) : null;
  } catch {
    lastSync = null;
  }
  const thisWeek = weekMonday();
  const stale = meetingsReady && (!lastSync || Date.now() - new Date(lastSync).getTime() > STALE_AFTER_MS || ((start === thisWeek || start === addDays(thisWeek, 7)) && !floor.fetchedAt));

  return NextResponse.json({
    start,
    thisWeek,
    scope,
    view,
    headline: weekHeadline(view),
    deadlines,
    boardItems,
    bills,
    hasTopics: ctx.topics.length > 0,
    trackedCount: ctx.tracked.size,
    floorSource: floor.sourceUrl,
    floorFetchedAt: floor.fetchedAt,
    lastSync,
    stale,
    // False until supabase/migrations/0002_week_ahead.sql has been run.
    ready: meetingsReady,
  });
}

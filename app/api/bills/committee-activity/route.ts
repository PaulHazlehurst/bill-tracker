import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCommitteeActivity } from "@/lib/congress-api";

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days - doubled from 3 to halve repeat-fetch frequency as usage grows

// GET ?billId=&congress=&billType=&billNumber=
// Same cache-on-the-bills-row pattern as related/actions/cosponsors.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const billId = req.nextUrl.searchParams.get("billId");
  const congress = req.nextUrl.searchParams.get("congress");
  const billType = req.nextUrl.searchParams.get("billType");
  const billNumber = req.nextUrl.searchParams.get("billNumber");
  if (!billId || !congress || !billType || !billNumber) {
    return NextResponse.json({ error: "missing bill identifier" }, { status: 400 });
  }

  const { data: cached } = await supabase
    .from("bills")
    .select("committee_activity, committee_activity_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.committee_activity_fetched_at &&
    Date.now() - new Date(cached.committee_activity_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh && cached?.committee_activity) {
    return NextResponse.json({ committees: cached.committee_activity });
  }

  try {
    const committees = await getCommitteeActivity(Number(congress), billType, billNumber);
    const admin = createAdminClient();
    await admin.from("bills").update({
      committee_activity: committees,
      committee_activity_fetched_at: new Date().toISOString(),
    }).eq("id", billId);
    return NextResponse.json({ committees });
  } catch (err) {
    console.error("committee activity fetch failed", err);
    if (cached?.committee_activity) return NextResponse.json({ committees: cached.committee_activity, stale: true });
    return NextResponse.json({ error: "could not fetch committee activity" }, { status: 502 });
  }
}

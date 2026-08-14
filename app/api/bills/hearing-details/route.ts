import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCommitteeActivity, findMatchingHearingDetails } from "@/lib/congress-api";

// Longer than the other caches - this one is expensive (multiple requests
// per lookup) and hearing detail essentially never changes once published,
// so there's little value in refreshing it often.
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// GET ?billId=&congress=&billType=&billNumber=
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
    .select("hearing_details, hearing_details_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.hearing_details_fetched_at &&
    Date.now() - new Date(cached.hearing_details_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh && cached?.hearing_details) {
    return NextResponse.json({ hearings: cached.hearing_details });
  }

  try {
    // Needs the committee activity (dates) first to know which hearings to
    // look for - reuses the same cache the /committee-activity route
    // writes to, rather than a redundant fetch.
    const { data: committeeCache } = await supabase
      .from("bills")
      .select("committee_activity")
      .eq("id", billId)
      .single();

    const committees = committeeCache?.committee_activity ?? await getCommitteeActivity(Number(congress), billType, billNumber);
    const hearings = await findMatchingHearingDetails(Number(congress), billType, billNumber, committees);

    const admin = createAdminClient();
    await admin.from("bills").update({
      hearing_details: hearings,
      hearing_details_fetched_at: new Date().toISOString(),
    }).eq("id", billId);

    return NextResponse.json({ hearings });
  } catch (err) {
    console.error("hearing detail fetch failed", err);
    if (cached?.hearing_details) return NextResponse.json({ hearings: cached.hearing_details, stale: true });
    return NextResponse.json({ error: "could not fetch hearing details" }, { status: 502 });
  }
}

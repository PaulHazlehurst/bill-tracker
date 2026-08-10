import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getRelatedBills } from "@/lib/congress-api";

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// GET ?billId=&congress=&billType=&billNumber=
// Cached on the bills row (see schema.sql: related_bills / related_bills_fetched_at).
// If several teammates open the same bill's page, this only hits congress.gov
// once every few days instead of once per person per view - a real, meaningful
// quota saving now that this is actually wired up to the cache columns.
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
    .select("related_bills, related_bills_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.related_bills_fetched_at &&
    Date.now() - new Date(cached.related_bills_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh && cached?.related_bills) {
    return NextResponse.json({ related: cached.related_bills });
  }

  try {
    const related = await getRelatedBills(Number(congress), billType, billNumber);
    const admin = createAdminClient();
    await admin.from("bills").update({
      related_bills: related,
      related_bills_fetched_at: new Date().toISOString(),
    }).eq("id", billId);
    return NextResponse.json({ related });
  } catch (err) {
    console.error("related bills fetch failed", err);
    // Fall back to a stale cache rather than nothing, if we have one.
    if (cached?.related_bills) return NextResponse.json({ related: cached.related_bills, stale: true });
    return NextResponse.json({ error: "could not fetch related bills" }, { status: 502 });
  }
}

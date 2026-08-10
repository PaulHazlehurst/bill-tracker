import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCosponsorBreakdown } from "@/lib/congress-api";

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// GET ?billId=&congress=&billType=&billNumber=
// Same cache-on-the-bills-row pattern as related/actions. Powers the
// "Cosponsors by party" chart on the bill detail page.
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
    .select("cosponsor_breakdown, cosponsor_breakdown_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.cosponsor_breakdown_fetched_at &&
    Date.now() - new Date(cached.cosponsor_breakdown_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh && cached?.cosponsor_breakdown) {
    return NextResponse.json({ breakdown: cached.cosponsor_breakdown });
  }

  try {
    const breakdown = await getCosponsorBreakdown(Number(congress), billType, billNumber);
    const admin = createAdminClient();
    await admin.from("bills").update({
      cosponsor_breakdown: breakdown,
      cosponsor_breakdown_fetched_at: new Date().toISOString(),
    }).eq("id", billId);
    return NextResponse.json({ breakdown });
  } catch (err) {
    console.error("cosponsor breakdown fetch failed", err);
    if (cached?.cosponsor_breakdown) return NextResponse.json({ breakdown: cached.cosponsor_breakdown, stale: true });
    return NextResponse.json({ error: "could not fetch cosponsor breakdown" }, { status: 502 });
  }
}

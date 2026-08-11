import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { searchFilingsForBill, billCitationForLda } from "@/lib/lda-api";

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
    .select("lobbying_activity, lobbying_activity_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.lobbying_activity_fetched_at &&
    Date.now() - new Date(cached.lobbying_activity_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh) {
    return NextResponse.json({ filings: cached?.lobbying_activity ?? [] });
  }

  try {
    const citation = billCitationForLda(billType, billNumber);
    const filings = await searchFilingsForBill(citation, Number(congress));
    const admin = createAdminClient();
    await admin.from("bills").update({
      lobbying_activity: filings,
      lobbying_activity_fetched_at: new Date().toISOString(),
    }).eq("id", billId);
    return NextResponse.json({ filings });
  } catch (err) {
    console.error("lobbying activity fetch failed", err);
    // Fail quiet, not loud - this is a supplementary, best-effort feature.
    return NextResponse.json({ filings: cached?.lobbying_activity ?? [] });
  }
}

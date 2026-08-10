import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getBillActions } from "@/lib/congress-api";

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// GET ?billId=&congress=&billType=&billNumber=
// Same cache-on-the-bills-row pattern as /api/bills/related. This is what
// powers the "Vote history" section on the bill detail page - the FULL
// action history, not just whatever our once-daily poller happened to
// catch in bill_events.
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
    .select("actions_cache, actions_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.actions_fetched_at &&
    Date.now() - new Date(cached.actions_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh && cached?.actions_cache) {
    return NextResponse.json({ actions: cached.actions_cache });
  }

  try {
    const actions = await getBillActions(Number(congress), billType, billNumber);
    const admin = createAdminClient();
    await admin.from("bills").update({
      actions_cache: actions,
      actions_fetched_at: new Date().toISOString(),
    }).eq("id", billId);
    return NextResponse.json({ actions });
  } catch (err) {
    console.error("actions fetch failed", err);
    if (cached?.actions_cache) return NextResponse.json({ actions: cached.actions_cache, stale: true });
    return NextResponse.json({ error: "could not fetch action history" }, { status: 502 });
  }
}

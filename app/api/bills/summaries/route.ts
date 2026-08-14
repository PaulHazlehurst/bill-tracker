import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getBillSummaries } from "@/lib/congress-api";

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days - doubled from 3 to halve repeat-fetch frequency as usage grows

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
    .select("summaries, summaries_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.summaries_fetched_at &&
    Date.now() - new Date(cached.summaries_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh && cached?.summaries) {
    return NextResponse.json({ summaries: cached.summaries });
  }

  try {
    const summaries = await getBillSummaries(Number(congress), billType, billNumber);
    const admin = createAdminClient();
    await admin.from("bills").update({
      summaries,
      summaries_fetched_at: new Date().toISOString(),
    }).eq("id", billId);
    return NextResponse.json({ summaries });
  } catch (err) {
    console.error("summaries fetch failed", err);
    if (cached?.summaries) return NextResponse.json({ summaries: cached.summaries, stale: true });
    return NextResponse.json({ error: "could not fetch summaries" }, { status: 502 });
  }
}

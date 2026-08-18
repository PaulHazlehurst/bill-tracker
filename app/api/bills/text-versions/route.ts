import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getBillTextVersions } from "@/lib/congress-api";

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

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
    .select("text_versions, text_versions_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.text_versions_fetched_at &&
    Date.now() - new Date(cached.text_versions_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh) {
    return NextResponse.json({ versions: cached?.text_versions ?? [] });
  }

  try {
    const versions = await getBillTextVersions(Number(congress), billType, billNumber);
    const admin = createAdminClient();
    await admin.from("bills").update({
      text_versions: versions,
      text_versions_fetched_at: new Date().toISOString(),
    }).eq("id", billId);
    return NextResponse.json({ versions });
  } catch (err) {
    console.error("text versions fetch failed", err);
    return NextResponse.json({ versions: cached?.text_versions ?? [] });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { searchCongressionalRecord } from "@/lib/govinfo-api";

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
    .select("congressional_record_mentions, congressional_record_mentions_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.congressional_record_mentions_fetched_at &&
    Date.now() - new Date(cached.congressional_record_mentions_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh) {
    return NextResponse.json({ mentions: cached?.congressional_record_mentions ?? [] });
  }

  try {
    const typeMap: Record<string, string> = {
      hr: "H.R.", s: "S.", hjres: "H.J.Res.", sjres: "S.J.Res.",
      hconres: "H.Con.Res.", sconres: "S.Con.Res.", hres: "H.Res.", sres: "S.Res.",
    };
    const citation = `${typeMap[billType.toLowerCase()] ?? billType.toUpperCase()} ${billNumber}`;

    const mentions = await searchCongressionalRecord(citation, Number(congress));
    const admin = createAdminClient();
    await admin.from("bills").update({
      congressional_record_mentions: mentions,
      congressional_record_mentions_fetched_at: new Date().toISOString(),
    }).eq("id", billId);
    return NextResponse.json({ mentions });
  } catch (err) {
    console.error("congressional record search failed", err);
    return NextResponse.json({ mentions: cached?.congressional_record_mentions ?? [] });
  }
}

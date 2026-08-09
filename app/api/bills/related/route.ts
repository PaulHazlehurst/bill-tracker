import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRelatedBills } from "@/lib/congress-api";

// GET ?congress=&billType=&billNumber=
// Called on-demand when someone opens a bill's detail page - not batched,
// not part of the poller, so there's no meaningful rate-limit concern here.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const congress = req.nextUrl.searchParams.get("congress");
  const billType = req.nextUrl.searchParams.get("billType");
  const billNumber = req.nextUrl.searchParams.get("billNumber");
  if (!congress || !billType || !billNumber) {
    return NextResponse.json({ error: "missing bill identifier" }, { status: 400 });
  }

  try {
    const related = await getRelatedBills(Number(congress), billType, billNumber);
    return NextResponse.json({ related });
  } catch (err) {
    console.error("related bills fetch failed", err);
    return NextResponse.json({ error: "could not fetch related bills" }, { status: 502 });
  }
}

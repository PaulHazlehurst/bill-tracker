import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET ?billId=... - every member position recorded for one specific bill.
// RLS on member_positions already scopes this to the signed-in user's own
// org's members (see schema.sql), so no org_id filter is needed here.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const billId = req.nextUrl.searchParams.get("billId");
  if (!billId) return NextResponse.json({ error: "missing billId" }, { status: 400 });

  const { data, error } = await supabase.from("member_positions").select("member_id, position").eq("bill_id", billId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ positions: data ?? [] });
}

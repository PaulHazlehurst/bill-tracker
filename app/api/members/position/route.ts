import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST { memberId, billId, position } - set (or update) one member's
// stance on one specific bill. Upsert, since a member either doesn't have
// a position row yet for this bill, or is changing their existing one.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { memberId, billId, position } = await req.json();
  if (!memberId || !billId || !position) {
    return NextResponse.json({ error: "missing memberId, billId, or position" }, { status: 400 });
  }
  if (!["support", "oppose", "watching", "none"].includes(position)) {
    return NextResponse.json({ error: "invalid position" }, { status: 400 });
  }

  const { error } = await supabase
    .from("member_positions")
    .upsert({ member_id: memberId, bill_id: billId, position, updated_at: new Date().toISOString() }, { onConflict: "member_id,bill_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

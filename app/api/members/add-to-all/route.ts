import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST { memberId, position? } - adds this member to every bill the org
// currently tracks, with a starting position (defaults to "watching" -
// a real signal to go set their actual stance, not silently "none").
// Bills the member already has a position on are left untouched.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { memberId, position } = await req.json();
  if (!memberId) return NextResponse.json({ error: "missing memberId" }, { status: 400 });
  const startingPosition = position && ["support", "oppose", "watching", "none"].includes(position) ? position : "watching";

  // RLS scopes tracked_bills to "your own, plus your org's" - since
  // members are inherently org-scoped, this naturally covers the whole
  // team's tracked bills, not just the person clicking the button.
  const { data: tracked } = await supabase.from("tracked_bills").select("bill_id");
  const billIds = Array.from(new Set((tracked ?? []).map((r) => r.bill_id)));
  if (billIds.length === 0) return NextResponse.json({ added: 0 });

  const { data: existing } = await supabase.from("member_positions").select("bill_id").eq("member_id", memberId);
  const alreadyHas = new Set((existing ?? []).map((r) => r.bill_id));

  const rowsToInsert = billIds
    .filter((id) => !alreadyHas.has(id))
    .map((billId) => ({ member_id: memberId, bill_id: billId, position: startingPosition }));

  if (rowsToInsert.length === 0) return NextResponse.json({ added: 0 });

  const { error } = await supabase.from("member_positions").insert(rowsToInsert);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ added: rowsToInsert.length });
}

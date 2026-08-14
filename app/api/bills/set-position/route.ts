import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID = ["support", "oppose", "watching", "none"];

// POST { billId, position }
// Sets the signed-in user's own stance on a bill they track. RLS
// (auth.uid() = user_id) means this can never touch another user's row.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { billId, position } = await req.json();
  if (!billId || !VALID.includes(position)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { error } = await supabase
    .from("tracked_bills")
    .update({ position })
    .eq("bill_id", billId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

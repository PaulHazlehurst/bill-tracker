import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET - list non-dismissed prospective bills for the signed-in user's
// owner (their org if they're on one, otherwise themselves). RLS already
// scopes this correctly - see schema.sql.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("prospective_bills")
    .select("id, bill_id, matched_topic, discovered_at, bills(title, status_stage, progress_pct)")
    .eq("dismissed", false)
    .order("discovered_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ prospective: data ?? [] });
}

// PATCH { id } - dismiss a suggestion. RLS ensures this only ever touches
// rows the signed-in user's own org (or the user themself) can see.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase.from("prospective_bills").update({ dismissed: true }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

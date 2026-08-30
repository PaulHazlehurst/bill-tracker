import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/regulations
// Returns the regulations the daily discovery run has flagged for this
// account, joined against the cached regulations table. RLS scopes the
// prospective_regulations read to the caller's own org or account.
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("prospective_regulations")
    .select("id, regulation_id, matched_topic, discovered_at, dismissed, regulations(*)")
    .eq("dismissed", false)
    .order("discovered_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("regulations fetch failed", error);
    return NextResponse.json({ error: "db error", regulations: [] }, { status: 500 });
  }
  return NextResponse.json({ regulations: data ?? [] });
}

// PATCH /api/regulations
// Body: { id } — dismiss a match (mirrors /api/prospective PATCH). Same
// RLS check applies via the update policy on prospective_regulations.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body?.id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase
    .from("prospective_regulations")
    .update({ dismissed: true })
    .eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET - suggestions for the signed-in user's owner (their team, or
// themselves). RLS scopes this - see schema.sql.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const base = "id, bill_id, matched_topic, discovered_at, bills(title, status_stage, progress_pct, latest_action, latest_action_date, bill_type)";
  let { data, error } = await supabase
    .from("prospective_bills")
    .select(`${base}, match_reason, match_score`)
    .eq("dismissed", false)
    .order("discovered_at", { ascending: false })
    .limit(80);
  // Before the Oct 2026 migration there's no match_reason/match_score.
  if (error && /match_/.test(error.message)) {
    ({ data, error } = await supabase.from("prospective_bills").select(base).eq("dismissed", false).order("discovered_at", { ascending: false }).limit(80) as any);
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Ceremonial resolutions never belong in suggestions.
  const RESOLUTION_TYPES = new Set(["hres", "sres", "hconres", "sconres"]);
  const rows = (data ?? []).filter((row: any) => !RESOLUTION_TYPES.has(String(row.bill_id ?? "").split("-")[0]));
  // Newest batch first; within a batch, strongest match first.
  rows.sort((a: any, b: any) => {
    const day = String(b.discovered_at).slice(0, 10).localeCompare(String(a.discovered_at).slice(0, 10));
    return day || (b.match_score ?? 0) - (a.match_score ?? 0);
  });
  return NextResponse.json({ prospective: rows.slice(0, 50) });
}

// PATCH { id } or { ids: [] } - dismiss suggestions.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : [];
  if (ids.length === 0) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase.from("prospective_bills").update({ dismissed: true }).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

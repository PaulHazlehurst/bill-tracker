import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

// POST { kind: "drug" | "board", id } - someone checked this entry against its
// source and it's still right. Resets the 30-day reminder and clears
// "Needs a check". Recorded in the drug's history.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string") return NextResponse.json({ error: "missing id" }, { status: 400 });
  const now = new Date().toISOString();

  if (body.kind === "board") {
    const { error } = await supabase.from("drug_boards").update({ confirmed_at: now, confirmed_by: user.id }).eq("state", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, confirmed_at: now });
  }
  if (body.kind === "drug") {
    const { data, error } = await supabase.from("board_drugs").update({ confirmed_at: now, confirmed_by: user.id, needs_check: false }).eq("id", body.id).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: "That drug isn't in the tracker." }, { status: 404 });
    await supabase.from("board_drug_changes").insert({ board_drug_id: body.id, changed_by: user.id, summary: "Checked against the source: still right" });
    return NextResponse.json({ ok: true, confirmed_at: now });
  }
  return NextResponse.json({ error: "unknown kind" }, { status: 400 });
}

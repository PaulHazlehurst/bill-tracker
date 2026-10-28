import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { cleanDrugInput, describeDrugChanges } from "@/lib/drugBoards";

// GET ?id= - one drug's change history.
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const { data } = await auth.supabase.from("board_drug_changes").select("id, changed_at, changed_by, summary").eq("board_drug_id", id).order("changed_at", { ascending: false }).limit(50);
  const ids = Array.from(new Set(((data as any[]) ?? []).map((c) => c.changed_by).filter(Boolean)));
  const { data: people } = ids.length ? await auth.supabase.from("profiles").select("id, email").in("id", ids) : { data: [] };
  const who = new Map(((people as any[]) ?? []).map((p) => [p.id, p.email]));
  return NextResponse.json({ history: ((data as any[]) ?? []).map((c) => ({ ...c, by: who.get(c.changed_by) ?? null })) });
}

// POST - add a drug to the tracker.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const { fields, error } = cleanDrugInput(await req.json().catch(() => ({})));
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!fields.state || !fields.drug) return NextResponse.json({ error: "Pick a state and name the drug." }, { status: 400 });
  const { data, error: insertError } = await supabase.from("board_drugs").insert({ ...fields, created_by: user.id, updated_by: user.id }).select("id").single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  await supabase.from("board_drug_changes").insert({ board_drug_id: data.id, changed_by: user.id, summary: "Added to the tracker" });
  return NextResponse.json({ id: data.id });
}

// PATCH { id, ...fields } - updates a drug and records what changed.
export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string") return NextResponse.json({ error: "missing id" }, { status: 400 });
  const { fields, error } = cleanDrugInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const { data: before } = await supabase.from("board_drugs").select("*").eq("id", body.id).maybeSingle();
  if (!before) return NextResponse.json({ error: "That drug isn't in the tracker." }, { status: 404 });
  const changes = describeDrugChanges(before, fields);
  if (!changes.length) return NextResponse.json({ ok: true, changes: [] });
  const { error: updateError } = await supabase.from("board_drugs").update({ ...fields, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", body.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  await supabase.from("board_drug_changes").insert(changes.map((summary) => ({ board_drug_id: body.id, changed_by: user.id, summary })));
  return NextResponse.json({ ok: true, changes });
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const { error } = await auth.supabase.from("board_drugs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

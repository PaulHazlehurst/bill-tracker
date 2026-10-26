import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { buildNewBillRow, nextPollAt } from "@/lib/billRefresh";
import { billIdFromCitation, congressForDate } from "@/lib/billMeta";

export const maxDuration = 30;

const BILL_ID = /^(hr|s|hjres|sjres|hconres|sconres|hres|sres)-(\d{1,5})-(\d{2,3})$/;
const POSITIONS = new Set(["support", "oppose", "watching", "none"]);

async function canAccess(supabase: any, clientId: string) {
  const { data } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  return !!data;
}

// POST { billId } or { citation: "H.R. 4120" } [, position] - adds a bill to the client.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await canAccess(supabase, params.id))) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const billId: string | null = typeof body.billId === "string" && BILL_ID.test(body.billId) ? body.billId : typeof body.citation === "string" ? billIdFromCitation(body.citation, congressForDate()) : null;
  if (!billId) return NextResponse.json({ error: "Enter a bill number like H.R. 1234 or S. 56." }, { status: 400 });
  const position = POSITIONS.has(body.position) ? body.position : "watching";

  // Make sure we have the bill (it may never have been opened in the app).
  const { data: existing } = await supabase.from("bills").select("id").eq("id", billId).maybeSingle();
  if (!existing) {
    const m = billId.match(BILL_ID)!;
    try {
      const row = await buildNewBillRow(Number(m[3]), m[1], Number(m[2]));
      row.next_poll_at = nextPollAt(String(row.status_stage), false);
      row.poll_priority = "dormant";
      const { error } = await createAdminClient().from("bills").insert(row);
      if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
    } catch {
      return NextResponse.json({ error: `Couldn't find ${body.citation ?? billId} on congress.gov.` }, { status: 404 });
    }
  }

  const { error } = await supabase.from("client_bills").insert({ client_id: params.id, bill_id: billId, position, added_by: user.id });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "That bill is already on this client's list." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await supabase.from("clients").update({ updated_at: new Date().toISOString() }).eq("id", params.id);
  return NextResponse.json({ ok: true, billId });
}

// PATCH { billId, position?, note? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.billId !== "string") return NextResponse.json({ error: "missing bill" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (POSITIONS.has(body.position)) patch.position = body.position;
  if (typeof body.note === "string" || body.note === null) patch.note = body.note ? String(body.note).slice(0, 1000) : null;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  const { error } = await supabase.from("client_bills").update(patch).eq("client_id", params.id).eq("bill_id", body.billId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE ?billId=
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const billId = req.nextUrl.searchParams.get("billId");
  if (!billId) return NextResponse.json({ error: "missing bill" }, { status: 400 });
  const { error } = await supabase.from("client_bills").delete().eq("client_id", params.id).eq("bill_id", billId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

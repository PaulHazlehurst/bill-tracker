import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { cleanCaseInput } from "@/lib/boardReading";

// POST - follow a court case about a drug board.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { fields, error } = cleanCaseInput(await req.json().catch(() => ({})));
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!fields.state || !fields.name) return NextResponse.json({ error: "Pick a state and name the case." }, { status: 400 });
  if (!fields.courtlistener_id && !(fields.court_code && fields.docket_number)) {
    return NextResponse.json({ error: "Paste the case's CourtListener link, or give the court code and docket number, so new filings can be found." }, { status: 400 });
  }
  const { data, error: insertError } = await auth.supabase
    .from("board_cases")
    .insert({ ...fields, court: fields.court || "Court", created_by: auth.user.id })
    .select("id")
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

// PATCH { id, ...fields }
export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string") return NextResponse.json({ error: "missing id" }, { status: 400 });
  const { fields, error } = cleanCaseInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  // A new docket means looking it up again.
  const relink = "court_code" in fields || "docket_number" in fields ? { courtlistener_id: fields.courtlistener_id ?? null } : {};
  const { error: updateError } = await auth.supabase.from("board_cases").update({ ...fields, ...relink, last_error: null }).eq("id", body.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const { error } = await auth.supabase.from("board_cases").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

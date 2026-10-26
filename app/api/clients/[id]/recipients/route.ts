import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST { email, name? } - adds someone at the client to the report list.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : null;

  const { data, error } = await supabase.from("client_recipients").insert({ client_id: params.id, email, name }).select("id, email, name").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "That address is already on the list." }, { status: 409 });
    return NextResponse.json({ error: error.code === "42501" ? "Client not found." : error.message }, { status: error.code === "42501" ? 404 : 500 });
  }
  return NextResponse.json({ recipient: data });
}

// DELETE ?id=
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const { error } = await supabase.from("client_recipients").delete().eq("id", id).eq("client_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

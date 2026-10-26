import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CLIENT_COLUMNS, loadClientBills } from "@/lib/clientReportData";

// GET - one client: its bills, report recipients, sent reports and the
// teammates who could lead it. Row-level security decides access.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase.from("clients").select(CLIENT_COLUMNS).eq("id", params.id).maybeSingle();
  if (!client) return NextResponse.json({ error: "That client doesn't exist, or belongs to another team." }, { status: 404 });

  const [bills, { data: recipients }, { data: reports }, { data: team }] = await Promise.all([
    loadClientBills(supabase, client.id),
    supabase.from("client_recipients").select("id, email, name").eq("client_id", client.id).order("created_at"),
    supabase.from("client_reports").select("id, week_of, sent_at, sent_to, sent_by, is_test").eq("client_id", client.id).order("sent_at", { ascending: false }).limit(10),
    client.organization_id
      ? supabase.from("profiles").select("id, email").eq("organization_id", client.organization_id)
      : supabase.from("profiles").select("id, email").eq("id", user.id),
  ]);

  return NextResponse.json({ client, bills, recipients: recipients ?? [], reports: reports ?? [], team: team ?? [] });
}

// PATCH { name?, notes?, reportEnabled?, reportAsk?, leadUserId? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "The name can't be empty." }, { status: 400 });
    patch.name = name;
  }
  if (typeof body.notes === "string" || body.notes === null) patch.notes = body.notes ? String(body.notes).slice(0, 4000) : null;
  if (typeof body.reportEnabled === "boolean") patch.report_enabled = body.reportEnabled;
  if (typeof body.reportAsk === "string" || body.reportAsk === null) patch.report_ask = body.reportAsk ? String(body.reportAsk).slice(0, 2000) : null;
  if (typeof body.leadUserId === "string" || body.leadUserId === null) patch.lead_user_id = body.leadUserId || null;

  const { data, error } = await supabase.from("clients").update(patch).eq("id", params.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "That client doesn't exist, or belongs to another team." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { error } = await supabase.from("clients").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

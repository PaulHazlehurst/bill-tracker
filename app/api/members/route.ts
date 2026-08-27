import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET - list the signed-in user's org's member roster. RLS scopes this
// automatically (see schema.sql) - members belong to an organization, not
// to individual users, so this requires being on a team.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("members")
    .select("id, name, role, category, email, phone, notes, bioguide_id, created_at")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ members: data ?? [] });
}

const MEMBER_FIELDS = "id, name, role, category, email, phone, notes, bioguide_id, created_at";

// Normalize an optional text field: trim, and treat empty as null so we
// never store blank strings that then display as empty rows.
function clean(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// POST { name, role?, category?, email?, phone?, notes?, bioguide_id? }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!profile?.organization_id) {
    return NextResponse.json({ error: "Members require being on a team - join or create one first." }, { status: 400 });
  }

  const body = await req.json();
  if (!body.name || !body.name.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("members")
    .insert({
      organization_id: profile.organization_id,
      name: body.name.trim(),
      role: clean(body.role),
      category: clean(body.category),
      email: clean(body.email),
      phone: clean(body.phone),
      notes: clean(body.notes),
      bioguide_id: clean(body.bioguide_id),
      created_by: user.id,
    })
    .select(MEMBER_FIELDS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ member: data });
}

// PATCH { id, ...fields } - edit a stakeholder's details (role, category,
// contact, notes). Only the fields provided are changed. RLS ensures this
// only ever touches the caller's own org's roster.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const patch: Record<string, string | null> = {};
  for (const field of ["role", "category", "email", "phone", "notes", "bioguide_id"]) {
    if (field in body) patch[field] = clean(body[field]);
  }
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const { data, error } = await supabase
    .from("members")
    .update(patch)
    .eq("id", body.id)
    .select(MEMBER_FIELDS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ member: data });
}

// DELETE ?id=... - remove a member (and, via cascade, their positions).
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase.from("members").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

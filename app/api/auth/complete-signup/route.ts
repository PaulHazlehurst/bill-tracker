import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Finishes account setup (organization + profile row) right after
// supabase.auth.signUp() on the client. This runs with the admin client,
// which bypasses Row Level Security - intentionally, because signUp()
// doesn't guarantee an active browser session yet (especially with email
// confirmation on), so an RLS-checked insert from the browser right after
// signing up can fail with "violates row-level security policy" even
// though the account was created successfully.
//
// Safety: this can only ever create ONE profile per user id (enforced by
// the profiles table's primary key), and only for a user id that genuinely
// exists in auth.users - it can't be used to hijack or edit an existing
// account's profile.
export async function POST(req: NextRequest) {
  const { userId, email, phone, organizationId, newOrgName } = await req.json();

  if (!userId || !email) {
    return NextResponse.json({ error: "Missing userId or email" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Confirm this is a real, just-created auth user - not an arbitrary id.
  const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
  if (authErr || !authUser?.user || authUser.user.email !== email) {
    return NextResponse.json({ error: "Could not verify account" }, { status: 400 });
  }

  // Refuse to run twice for the same user - profiles.id is the primary key,
  // so a duplicate insert would fail anyway, but check explicitly for a
  // clearer error message.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (existingProfile) {
    return NextResponse.json({ error: "Profile already exists" }, { status: 409 });
  }

  let finalOrgId: string | null = organizationId || null;

  if (newOrgName && String(newOrgName).trim()) {
    const { data: newOrg, error: orgErr } = await supabase
      .from("organizations")
      .insert({ name: String(newOrgName).trim() })
      .select("id")
      .single();
    if (orgErr) {
      return NextResponse.json({ error: "Could not create organization: " + orgErr.message }, { status: 400 });
    }
    finalOrgId = newOrg.id;
  }

  const { error: profileErr } = await supabase.from("profiles").insert({
    id: userId,
    email,
    phone: phone?.trim() || null,
    organization_id: finalOrgId,
  });

  if (profileErr) {
    return NextResponse.json({ error: "Could not create profile: " + profileErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

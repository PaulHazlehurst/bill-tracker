import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Finishes account setup (organization + profile row) right after
// supabase.auth.signUp() on the client. Runs with the admin client, which
// bypasses Row Level Security - intentionally, because signUp() doesn't
// guarantee an active browser session yet (especially with email
// confirmation on), so an RLS-checked insert from the browser right after
// signing up can fail even though the account was created successfully.
//
// Safety: this can only ever create ONE profile per user id (enforced by
// the profiles table's primary key), and only for a user id that genuinely
// exists in auth.users - it can't be used to hijack or edit an existing
// account's profile.
//
// teamMode is one of "create" | "join" | "none":
//   create -> makes a brand new team, this user becomes its owner
//   join   -> requires a valid inviteCode, found via exact match (not
//             guessable from a public list - there's no "browse teams" UI)
//   none   -> no team, can join or create one later from Settings
export async function POST(req: NextRequest) {
  const { userId, email, phone, teamMode, newOrgName, inviteCode } = await req.json();

  if (!userId || !email) {
    return NextResponse.json({ error: "Missing userId or email" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
  if (authErr || !authUser?.user || authUser.user.email !== email) {
    return NextResponse.json({ error: "Could not verify account" }, { status: 400 });
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (existingProfile) {
    return NextResponse.json({ error: "Profile already exists" }, { status: 409 });
  }

  let finalOrgId: string | null = null;

  if (teamMode === "create" && newOrgName && String(newOrgName).trim()) {
    const { data: newOrg, error: orgErr } = await supabase
      .from("organizations")
      .insert({ name: String(newOrgName).trim(), created_by: userId })
      .select("id")
      .single();
    if (orgErr) {
      const message = orgErr.code === "23505" ? "A team with that name already exists." : orgErr.message;
      return NextResponse.json({ error: "Could not create team: " + message }, { status: 400 });
    }
    finalOrgId = newOrg.id;
  } else if (teamMode === "join" && inviteCode && String(inviteCode).trim()) {
    const { data: org, error: findErr } = await supabase
      .from("organizations")
      .select("id")
      .eq("invite_code", String(inviteCode).trim().toUpperCase())
      .maybeSingle();
    if (findErr || !org) {
      return NextResponse.json({ error: "That invite code doesn't match any team." }, { status: 400 });
    }
    finalOrgId = org.id;
  }
  // teamMode === "none" (or anything else) leaves finalOrgId as null.

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

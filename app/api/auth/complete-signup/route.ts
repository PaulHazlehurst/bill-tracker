import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { inviteProblem } from "@/lib/team";

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
//   invite -> requires a valid invitation token sent to this same email
//   none   -> no team, can join or create one later from Settings
export async function POST(req: NextRequest) {
  const { userId, email, phone, teamMode, newOrgName, inviteCode, inviteToken, fullName } = await req.json();

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
  let role: "admin" | "member" = "member";
  let acceptInviteId: string | null = null;

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
    role = "admin";
  } else if (teamMode === "invite" && typeof inviteToken === "string" && inviteToken) {
    const { data: inv } = await supabase.from("team_invites").select("id, organization_id, email, role, expires_at, accepted_at, revoked_at").eq("token", inviteToken).maybeSingle();
    const problem = inviteProblem(inv as any);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (String(inv!.email).toLowerCase() !== String(email).toLowerCase()) {
      return NextResponse.json({ error: `This invitation is for ${inv!.email}. Sign up with that address, or ask for a new invitation.` }, { status: 400 });
    }
    finalOrgId = inv!.organization_id;
    role = inv!.role === "admin" ? "admin" : "member";
    acceptInviteId = inv!.id;
  } else if (teamMode === "join" && inviteCode && String(inviteCode).trim()) {
    const { data: org, error: findErr } = await supabase
      .from("organizations")
      .select("id, allow_code_join")
      .eq("invite_code", String(inviteCode).trim().toUpperCase())
      .maybeSingle();
    if (findErr || !org) {
      return NextResponse.json({ error: "That invite code doesn't match any team." }, { status: 400 });
    }
    if (org.allow_code_join === false) {
      return NextResponse.json({ error: "That team only accepts people by email invitation. Ask an admin to invite you." }, { status: 400 });
    }
    finalOrgId = org.id;
  }
  // teamMode === "none" (or anything else) leaves finalOrgId as null.

  const { error: profileErr } = await supabase.from("profiles").insert({
    id: userId,
    email,
    phone: phone?.trim() || null,
    organization_id: finalOrgId,
    team_role: role,
    ...(typeof fullName === "string" && fullName.trim() ? { full_name: fullName.trim().slice(0, 120) } : {}),
  });

  if (profileErr) {
    return NextResponse.json({ error: "Could not create profile: " + profileErr.message }, { status: 400 });
  }

  if (acceptInviteId) {
    await supabase.from("team_invites").update({ accepted_at: new Date().toISOString(), accepted_by: userId }).eq("id", acceptInviteId);
  }

  return NextResponse.json({ ok: true });
}

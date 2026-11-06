import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { createAdminClient } from "@/lib/supabase/server";
import { inviteProblem, joinTeam, leaveTeam, type TeamRole } from "@/lib/team";
import { notify } from "@/lib/notifications";

// POST { token } or { code }, plus { leaveCurrent: true } to switch teams.
// The only way onto a team: an invitation link (for the email it was sent
// to) or the team's invite code (if its admins allow joining by code).
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const body = await req.json().catch(() => ({}));

  let orgId: string;
  let role: TeamRole = "member";
  let inviteId: string | null = null;
  if (typeof body.token === "string" && body.token) {
    const { data: inv } = await admin.from("team_invites").select("id, organization_id, email, role, expires_at, accepted_at, revoked_at").eq("token", body.token).maybeSingle();
    const problem = inviteProblem(inv as any);
    if (problem) return NextResponse.json({ error: problem }, { status: 410 });
    if (String(inv!.email).toLowerCase() !== String(auth.user.email ?? "").toLowerCase()) {
      return NextResponse.json({ error: `This invitation is for ${inv!.email}. Sign in with that email address to accept it.`, wrongEmail: true }, { status: 403 });
    }
    orgId = inv!.organization_id;
    role = inv!.role === "admin" ? "admin" : "member";
    inviteId = inv!.id;
  } else if (typeof body.code === "string" && body.code.trim()) {
    const { data: org } = await admin.from("organizations").select("id, allow_code_join").eq("invite_code", body.code.trim().toUpperCase()).maybeSingle();
    if (!org) return NextResponse.json({ error: "That invite code doesn't match any team." }, { status: 404 });
    if (!org.allow_code_join) return NextResponse.json({ error: "This team only accepts people by invitation. Ask an admin to invite you by email." }, { status: 403 });
    orgId = org.id;
  } else {
    return NextResponse.json({ error: "Missing invitation." }, { status: 400 });
  }

  const { data: me } = await admin.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "Finish creating your account first." }, { status: 400 });
  if (me.organization_id === orgId) {
    if (inviteId) await admin.from("team_invites").update({ accepted_at: new Date().toISOString(), accepted_by: auth.user.id }).eq("id", inviteId);
    return NextResponse.json({ ok: true, already: true });
  }
  if (me.organization_id && body.leaveCurrent !== true) {
    return NextResponse.json({ error: "You're already on another team. Joining this one means leaving it.", needsLeave: true }, { status: 409 });
  }
  if (me.organization_id) await leaveTeam(admin, auth.user.id);

  try {
    await joinTeam(admin, auth.user, orgId, role, (adminIds, who) =>
      notify(admin, adminIds.map((userId) => ({ userId, kind: "team" as const, title: `${who} joined the team`, body: role === "admin" ? "They joined as an admin." : null, url: "/team", dedupeKey: `joined:${orgId}:${auth.user.id}:${new Date().toISOString().slice(0, 10)}` }))),
    );
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
  const now = new Date().toISOString();
  if (inviteId) await admin.from("team_invites").update({ accepted_at: now, accepted_by: auth.user.id }).eq("id", inviteId);
  // Any other open invitations to this person for this team are done too.
  await admin.from("team_invites").update({ accepted_at: now, accepted_by: auth.user.id }).eq("organization_id", orgId).eq("email", String(auth.user.email ?? "").toLowerCase()).is("accepted_at", null).is("revoked_at", null);
  return NextResponse.json({ ok: true });
}

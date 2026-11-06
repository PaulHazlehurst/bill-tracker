import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { createAdminClient } from "@/lib/supabase/server";
import { teamContext, roleChangeProblem, isAdmin, ROLE_LABELS, type TeamRole } from "@/lib/team";
import { notify } from "@/lib/notifications";

async function guard(memberId: unknown) {
  const auth = await requireUser();
  if ("error" in auth) return { error: auth.error } as const;
  const admin = createAdminClient();
  const ctx = await teamContext(admin, auth.user.id);
  if (!ctx.org) return { error: NextResponse.json({ error: "You're not on a team." }, { status: 400 }) } as const;
  if (typeof memberId !== "string") return { error: NextResponse.json({ error: "missing memberId" }, { status: 400 }) } as const;
  const { data: target } = await admin.from("profiles").select("id, email, team_role, organization_id").eq("id", memberId).maybeSingle();
  if (!target || target.organization_id !== ctx.org.id) return { error: NextResponse.json({ error: "That person isn't on your team." }, { status: 404 }) } as const;
  return { auth, admin, ctx, target } as const;
}

// PATCH { memberId, role } - make someone an admin or a member (admins only).
// PATCH { memberId, makeOwner: true } - hand ownership to someone (owner only).
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guard(body.memberId);
  if ("error" in g) return g.error;
  const org = g.ctx.org!;

  if (body.makeOwner === true) {
    if (org.created_by !== g.auth.user.id) return NextResponse.json({ error: "Only the team's owner can hand over ownership." }, { status: 403 });
    await g.admin.from("profiles").update({ team_role: "admin" }).eq("id", g.target.id);
    await g.admin.from("organizations").update({ created_by: g.target.id }).eq("id", org.id);
    await notify(g.admin, [{ userId: g.target.id, kind: "team", title: `You're now the owner of ${org.name}`, url: "/team" }]).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (!g.ctx.admin) return NextResponse.json({ error: "Only team admins can change roles." }, { status: 403 });
  const role: TeamRole = body.role === "admin" ? "admin" : "member";
  const { data: members } = await g.admin.from("profiles").select("id, team_role").eq("organization_id", org.id);
  const adminCount = ((members as any[]) ?? []).filter((m) => isAdmin(m, org.created_by)).length;
  const problem = roleChangeProblem(g.target, role, org.created_by, adminCount);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  await g.admin.from("profiles").update({ team_role: role }).eq("id", g.target.id);
  if (g.target.id !== g.auth.user.id && g.target.team_role !== role) {
    await notify(g.admin, [{ userId: g.target.id, kind: "team", title: `You're now ${role === "admin" ? "an admin" : "a member"} of ${org.name}`, body: role === "admin" ? "You can invite people, change roles and manage the team." : null, url: "/team" }]).catch(() => {});
  }
  return NextResponse.json({ ok: true, role: ROLE_LABELS[role] });
}

// DELETE { memberId } - take someone off the team (admins only). Their own
// tracked bills stay with them.
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guard(body.memberId);
  if ("error" in g) return g.error;
  if (!g.ctx.admin) return NextResponse.json({ error: "Only team admins can remove people." }, { status: 403 });
  if (g.target.id === g.auth.user.id) return NextResponse.json({ error: "To take yourself off the team, use Leave team in Settings." }, { status: 400 });
  if (g.target.id === g.ctx.org!.created_by) return NextResponse.json({ error: "The team's owner can't be removed. They can hand over ownership first." }, { status: 400 });
  const { error } = await g.admin.from("profiles").update({ organization_id: null, team_role: "member" }).eq("id", g.target.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

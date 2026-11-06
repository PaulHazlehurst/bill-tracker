import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { inviteProblem, displayName } from "@/lib/team";

// GET ?token= - what an invitation link is for (team name, who sent it,
// which email it's for), so the join page can show it before sign-in. The
// token is the secret; without it this reveals nothing.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) return NextResponse.json({ error: inviteProblem(null) }, { status: 404 });
  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("team_invites")
    .select("email, role, expires_at, accepted_at, revoked_at, invited_by, organizations(name, logo_url)")
    .eq("token", token)
    .maybeSingle();
  const problem = inviteProblem(inv as any);
  if (problem) return NextResponse.json({ error: problem }, { status: 410 });
  const org = Array.isArray((inv as any).organizations) ? (inv as any).organizations[0] : (inv as any).organizations;
  const { data: inviter } = inv!.invited_by ? await admin.from("profiles").select("full_name, email").eq("id", inv!.invited_by).maybeSingle() : { data: null };
  return NextResponse.json({ teamName: org?.name ?? "a team", logoUrl: org?.logo_url ?? null, email: inv!.email, role: inv!.role, inviter: inviter ? displayName(inviter) : null, expiresAt: inv!.expires_at });
}

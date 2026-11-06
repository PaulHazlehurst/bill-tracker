import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireUser } from "@/lib/requireUser";
import { createAdminClient } from "@/lib/supabase/server";
import { teamContext, parseEmails, displayName, type TeamRole } from "@/lib/team";
import { teamInviteEmail } from "@/lib/emailTemplate";

export const maxDuration = 30;

function joinUrl(req: NextRequest, token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  return `${base.replace(/\/$/, "")}/join/${token}`;
}

async function sendInvite(req: NextRequest, inv: { email: string; role: TeamRole; token: string; expires_at: string }, teamName: string, inviterName: string): Promise<string | null> {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return "email isn't set up, so copy the link and send it yourself";
  const expiresOn = new Date(inv.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const email = teamInviteEmail({ teamName, inviterName, role: inv.role, joinUrl: joinUrl(req, inv.token), expiresOn });
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.RESEND_FROM_EMAIL, to: inv.email, subject: email.subject, html: email.html, text: email.text });
  return error ? error.message ?? "the email service refused it" : null;
}

async function guard() {
  const auth = await requireUser();
  if ("error" in auth) return { error: auth.error } as const;
  const admin = createAdminClient();
  const ctx = await teamContext(admin, auth.user.id);
  if (!ctx.org) return { error: NextResponse.json({ error: "You're not on a team." }, { status: 400 }) } as const;
  if (!ctx.admin) return { error: NextResponse.json({ error: "Only team admins can manage invitations." }, { status: 403 }) } as const;
  return { auth, admin, ctx } as const;
}

// GET - open invitations for the caller's team (admins only).
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  const { data } = await g.admin
    .from("team_invites")
    .select("id, email, role, created_at, last_sent_at, expires_at, token")
    .eq("organization_id", g.ctx.org!.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return NextResponse.json({ invites: data ?? [] });
}

// POST { emails: "a@b.com, c@d.com", role } - invite people by email.
export async function POST(req: NextRequest) {
  const g = await guard();
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => ({}));
  const role: TeamRole = body.role === "admin" ? "admin" : "member";
  const { emails, invalid } = parseEmails(String(body.emails ?? ""));
  if (!emails.length) return NextResponse.json({ error: invalid.length ? `Couldn't read ${invalid.join(", ")} as an email address.` : "Add at least one email address." }, { status: 400 });

  const org = g.ctx.org!;
  // People already on this team don't need an invitation.
  const { data: existing } = await g.admin.from("profiles").select("email").eq("organization_id", org.id);
  const onTeam = new Set(((existing as any[]) ?? []).map((p) => String(p.email).toLowerCase()));
  const inviterName = displayName(g.ctx.me ?? {});
  const results: { email: string; status: "sent" | "created" | "already_member"; note?: string }[] = [];

  for (const email of emails) {
    if (onTeam.has(email)) {
      results.push({ email, status: "already_member" });
      continue;
    }
    // Re-inviting someone with an open invitation refreshes it rather than duplicating.
    const { data: open } = await g.admin
      .from("team_invites")
      .select("id")
      .eq("organization_id", org.id)
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .maybeSingle();
    const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const write = open
      ? g.admin.from("team_invites").update({ role, expires_at: expires, invited_by: g.auth.user.id }).eq("id", open.id).select("id, email, role, token, expires_at").single()
      : g.admin.from("team_invites").insert({ organization_id: org.id, email, role, invited_by: g.auth.user.id, expires_at: expires }).select("id, email, role, token, expires_at").single();
    const { data: inv, error } = await write;
    if (error || !inv) return NextResponse.json({ error: error?.message ?? "Couldn't save the invitation." }, { status: 500 });
    const problem = await sendInvite(req, inv, org.name, inviterName);
    if (!problem) await g.admin.from("team_invites").update({ last_sent_at: new Date().toISOString() }).eq("id", inv.id);
    results.push({ email, status: problem ? "created" : "sent", note: problem ?? undefined });
  }
  return NextResponse.json({ results, invalid });
}

// PATCH { id } - send an invitation again (and give it another 14 days).
export async function PATCH(req: NextRequest) {
  const g = await guard();
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => ({}));
  const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const { data: inv } = await g.admin
    .from("team_invites")
    .update({ expires_at: expires })
    .eq("id", String(body.id ?? ""))
    .eq("organization_id", g.ctx.org!.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id, email, role, token, expires_at")
    .maybeSingle();
  if (!inv) return NextResponse.json({ error: "That invitation isn't open any more." }, { status: 404 });
  const problem = await sendInvite(req, inv, g.ctx.org!.name, displayName(g.ctx.me ?? {}));
  if (problem) return NextResponse.json({ error: `Couldn't send it: ${problem}.` }, { status: 502 });
  await g.admin.from("team_invites").update({ last_sent_at: new Date().toISOString() }).eq("id", inv.id);
  return NextResponse.json({ ok: true });
}

// DELETE ?id= - cancel an invitation; its link stops working.
export async function DELETE(req: NextRequest) {
  const g = await guard();
  if ("error" in g) return g.error;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  await g.admin.from("team_invites").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("organization_id", g.ctx.org!.id);
  return NextResponse.json({ ok: true });
}

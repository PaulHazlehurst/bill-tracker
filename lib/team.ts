// Teams: who's on one, who can manage it, and invitations. The pure
// helpers at the top are tested in tests/team.test.ts; teamContext() is for
// API routes.

export type TeamRole = "admin" | "member";

export const ROLE_LABELS: Record<TeamRole, string> = { admin: "Admin", member: "Member" };
export const ROLE_HELP: Record<TeamRole, string> = {
  admin: "Can invite and remove people, change roles, rename the team and manage its invite code.",
  member: "Can follow bills, take positions, add notes and tasks, and manage clients.",
};

/** The name to show for someone: their name if they've set one, otherwise the part of their email before the @. */
export function displayName(p: { full_name?: string | null; email?: string | null }): string {
  const name = p.full_name?.trim();
  if (name) return name;
  const email = p.email ?? "";
  return email.includes("@") ? email.split("@")[0] : email || "Someone";
}

/** Two letters for an avatar: initials of the name, or the start of the email. */
export function initialsFor(p: { full_name?: string | null; email?: string | null }): string {
  const name = p.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase();
  }
  return (p.email ?? "?").slice(0, 2).toUpperCase();
}

/** The team's creator is always treated as an admin. */
export function isAdmin(p: { id: string; team_role?: string | null }, ownerId: string | null): boolean {
  return p.team_role === "admin" || (!!ownerId && p.id === ownerId);
}

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

/**
 * Email addresses typed or pasted into the invite box, separated by commas,
 * semicolons, spaces or new lines, including "Name <a@b.com>" forms copied
 * from an email client. Returns the valid ones (lowercased, once each) and
 * whatever couldn't be read.
 */
export function parseEmails(text: string, max = 50): { emails: string[]; invalid: string[] } {
  const tokens = text
    .replace(/[<>]/g, " ")
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/^mailto:/i, ""))
    .filter(Boolean);
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    if (t.includes("@")) {
      const e = t.toLowerCase();
      if (EMAIL_RE.test(e)) {
        if (!emails.includes(e)) emails.push(e);
      } else invalid.push(t);
    }
    // Words without an @ are names from "Name <email>"; ignore them.
  }
  return { emails: emails.slice(0, max), invalid };
}

export type InviteRow = { email: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };

/** Why an invitation can't be used, in plain words, or null if it can. */
export function inviteProblem(inv: InviteRow | null, now = new Date()): string | null {
  if (!inv) return "This invitation link isn't valid. Ask the person who invited you to send a new one.";
  if (inv.revoked_at) return "This invitation was cancelled. Ask the team's admin for a new one.";
  if (inv.accepted_at) return "This invitation has already been used. Sign in to see your team.";
  if (Date.parse(inv.expires_at) < now.getTime()) return "This invitation has expired. Ask the team's admin to send a new one.";
  return null;
}

/**
 * Whether an admin may change this person's role. The owner's role is
 * fixed, and the last admin can't be made a member (someone has to be able
 * to manage the team).
 */
export function roleChangeProblem(target: { id: string; team_role: string }, newRole: TeamRole, ownerId: string | null, adminCount: number): string | null {
  if (target.id === ownerId) return "The team's owner is always an admin.";
  if (target.team_role === "admin" && newRole === "member" && adminCount <= 1) return "A team needs at least one admin.";
  return null;
}

/** Who takes over as owner when the owner leaves: another admin, else the longest-standing member. */
export function nextOwner(members: { id: string; team_role: string; created_at: string }[], leavingId: string): string | null {
  const rest = members.filter((m) => m.id !== leavingId);
  const admins = rest.filter((m) => m.team_role === "admin").sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (admins.length) return admins[0].id;
  const byAge = [...rest].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return byAge[0]?.id ?? null;
}

// ── For API routes ────────────────────────────────────────────────────

type Supa = any;

/** The caller's team, and whether they can manage it. Uses the admin client for the lookups. */
export async function teamContext(admin: Supa, userId: string) {
  const { data: me } = await admin.from("profiles").select("id, email, full_name, team_role, organization_id").eq("id", userId).maybeSingle();
  if (!me?.organization_id) return { me, org: null, admin: false } as const;
  const { data: org } = await admin.from("organizations").select("id, name, created_by, invite_code, allow_code_join").eq("id", me.organization_id).maybeSingle();
  return { me, org, admin: !!org && isAdmin(me, org.created_by) } as const;
}

/** Takes someone off their team. If they own it, ownership passes on (see nextOwner). */
export async function leaveTeam(admin: Supa, userId: string): Promise<void> {
  const { data: me } = await admin.from("profiles").select("organization_id").eq("id", userId).maybeSingle();
  const orgId = me?.organization_id;
  if (!orgId) return;
  const { data: org } = await admin.from("organizations").select("created_by").eq("id", orgId).maybeSingle();
  if (org?.created_by === userId) {
    const { data: members } = await admin.from("profiles").select("id, team_role, created_at").eq("organization_id", orgId);
    const heir = nextOwner((members as any[]) ?? [], userId);
    await admin.from("organizations").update({ created_by: heir }).eq("id", orgId);
    if (heir) await admin.from("profiles").update({ team_role: "admin" }).eq("id", heir);
  }
  await admin.from("profiles").update({ organization_id: null, team_role: "member" }).eq("id", userId);
}

/** Puts someone on a team with a role, and tells the team's admins. */
export async function joinTeam(admin: Supa, user: { id: string; email?: string | null }, orgId: string, role: TeamRole, notifyAdmins: (adminIds: string[], who: string) => Promise<unknown>) {
  const { error } = await admin.from("profiles").update({ organization_id: orgId, team_role: role }).eq("id", user.id);
  if (error) throw new Error(error.message);
  const { data: me } = await admin.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  const { data: org } = await admin.from("organizations").select("created_by").eq("id", orgId).maybeSingle();
  const { data: admins } = await admin.from("profiles").select("id, team_role").eq("organization_id", orgId);
  const adminIds = ((admins as any[]) ?? []).filter((p) => p.id !== user.id && isAdmin(p, org?.created_by ?? null)).map((p) => p.id);
  if (adminIds.length) await notifyAdmins(adminIds, displayName(me ?? { email: user.email }));
}

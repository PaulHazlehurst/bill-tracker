"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Users2, Mail, Copy, RotateCw, X, Crown, KeyRound, Pencil, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import BillList, { TableRow } from "@/components/BillList";
import PageHeader from "@/components/ui/PageHeader";
import OrgLogoUploader from "@/components/OrgLogoUploader";
import TeamNextActions from "@/components/TeamNextActions";
import { useUI } from "@/components/UIProvider";
import { useSession } from "@/components/SessionProvider";
import EmptyState from "@/components/EmptyState";
import { MotionItem } from "@/components/Motion";
import { animated, optimistic } from "@/lib/motion";
import { useTicker } from "@/lib/useTicker";
import { timeAgo } from "@/lib/billMeta";
import { displayName, initialsFor, isAdmin, ROLE_LABELS, ROLE_HELP, parseEmails, type TeamRole } from "@/lib/team";

type Member = { id: string; email: string; full_name: string | null; job_title: string | null; team_role: TeamRole; created_at: string };
type Invite = { id: string; email: string; role: TeamRole; created_at: string; last_sent_at: string | null; expires_at: string; token: string };
type Org = { id: string; name: string; logo_url: string | null; invite_code: string; created_by: string | null; allow_code_join: boolean };

// The team: who's on it and what they do, invitations (for admins), the
// shared task board, and every bill the team follows.
export default function TeamPage() {
  const supabase = createClient();
  const { toast, confirm } = useUI();
  const { refresh: refreshSession } = useSession();
  const router = useRouter();
  useTicker();

  const [rows, setRows] = useState<TableRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [noOrg, setNoOrg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [needsUpdate, setNeedsUpdate] = useState(false);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return router.push("/login");
    setSelfId(user.id);

    const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }
    if (!profile?.organization_id) {
      setNoOrg(true);
      setLoading(false);
      return;
    }
    const oid = profile.organization_id;

    const [orgRes, memberRes, billsRes] = await Promise.all([
      supabase.from("organizations").select("id, name, logo_url, invite_code, created_by, allow_code_join").eq("id", oid).single(),
      supabase.from("profiles").select("id, email, full_name, job_title, team_role, created_at").eq("organization_id", oid).order("created_at"),
      // RLS decides visibility from each tracker's current team (see schema.sql).
      supabase
        .from("tracked_bills")
        .select("id, bill_id, user_id, notify_email, notify_sms, position, created_at, bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url, raw_snapshot, last_polled_at)")
        .order("created_at", { ascending: false }),
    ]);
    if (orgRes.error || memberRes.error) {
      // Before database update 0007, the new columns don't exist yet.
      setNeedsUpdate(true);
      setError("The Team page needs database update 0007. Ask whoever manages the app to run it (Data sources lists it).");
      setLoading(false);
      return;
    }
    setOrg(orgRes.data as Org);
    setMembers((memberRes.data as Member[]) ?? []);
    if (billsRes.error) setError(billsRes.error.message);
    setRows((billsRes.data as any) ?? []);
    setLoading(false);

    const me = (memberRes.data as Member[]).find((m) => m.id === user.id);
    if (me && isAdmin(me, (orgRes.data as Org).created_by)) loadInvites();
  }

  async function loadInvites() {
    const res = await fetch("/api/team/invites");
    if (res.ok) setInvites((await res.json()).invites ?? []);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const me = members.find((m) => m.id === selfId) ?? null;
  const ownerId = org?.created_by ?? null;
  const amAdmin = !!me && isAdmin(me, ownerId);
  const names: Record<string, string> = useMemo(() => Object.fromEntries(members.map((m) => [m.id, displayName(m)])), [members]);
  const billsBy = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => r.user_id && (counts[r.user_id] = (counts[r.user_id] ?? 0) + 1));
    return counts;
  }, [rows]);

  // Bills where teammates have taken opposing positions: the one thing
  // here you can't see by reading the list.
  const contested = useMemo(() => {
    const byBill: Record<string, TableRow[]> = {};
    rows.forEach((r) => (byBill[r.bill_id] ??= []).push(r));
    return Object.entries(byBill)
      .filter(([, g]) => g.length > 1 && new Set(g.map((x) => x.position)).has("support") && new Set(g.map((x) => x.position)).has("oppose"))
      .map(([billId, g]) => {
        const bill = Array.isArray(g[0].bills) ? g[0].bills[0] : g[0].bills;
        return { billId, title: (bill as any)?.title ?? billId };
      });
  }, [rows]);

  async function changeRole(m: Member, role: TeamRole) {
    const before = members;
    await optimistic({
      apply: () => setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, team_role: role } : x))),
      revert: () => setMembers(before),
      save: async () => {
        const res = await fetch("/api/team/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: m.id, role }) });
        if (!res.ok) toast((await res.json().catch(() => ({}))).error ?? "Couldn't change that role.", "error");
        return res.ok;
      },
    });
  }

  async function removeMember(m: Member) {
    if (!(await confirm(`Take ${displayName(m)} off the team? They keep their account and the bills they track, but stop seeing the team's.`, { confirmLabel: "Remove", danger: true }))) return;
    const before = members;
    const ok = await optimistic({
      apply: () => setMembers((prev) => prev.filter((x) => x.id !== m.id)),
      revert: () => setMembers(before),
      save: () => fetch("/api/team/members", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: m.id }) }),
      onError: () => toast("Couldn't remove them. Try again.", "error"),
    });
    if (ok) toast(`${displayName(m)} is off the team`, "info");
  }

  async function makeOwner(m: Member) {
    if (!(await confirm(`Make ${displayName(m)} the team's owner? You'll stay an admin, but only they will be able to hand ownership on.`, { confirmLabel: "Make owner" }))) return;
    const res = await fetch("/api/team/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: m.id, makeOwner: true }) });
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? "Couldn't hand over ownership.", "error");
    toast(`${displayName(m)} now owns the team`, "success");
    load();
  }

  async function resend(inv: Invite) {
    const res = await fetch("/api/team/invites", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: inv.id }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast(body.error ?? "Couldn't send it again.", "error");
    toast(`Sent again to ${inv.email}`, "success");
    loadInvites();
  }

  async function revoke(inv: Invite) {
    const before = invites;
    const ok = await optimistic({
      apply: () => setInvites((prev) => prev.filter((x) => x.id !== inv.id)),
      revert: () => setInvites(before),
      save: () => fetch(`/api/team/invites?id=${inv.id}`, { method: "DELETE" }),
      onError: () => toast("Couldn't cancel it.", "error"),
    });
    if (ok) toast(`Invitation to ${inv.email} cancelled; its link no longer works`, "info");
  }

  function copyLink(inv: Invite) {
    navigator.clipboard.writeText(`${window.location.origin}/join/${inv.token}`).then(() => toast("Invitation link copied. It only works for " + inv.email, "success"));
  }

  return (
    <div className="page page-wide">
      <PageHeader
        title={org?.name ?? "Your team"}
        description={org ? `${members.length} ${members.length === 1 ? "person" : "people"}${invites.length ? `, ${invites.length} invited` : ""}. Everyone sees the bills the team follows, takes positions, and shares notes and tasks.` : "Who's on your team and what it's working on."}
        actions={
          !noOrg && org ? (
            <>
              <a href="/api/export?scope=team" className="btn btn-secondary">Export CSV</a>
              {amAdmin && <button className="btn btn-primary" onClick={() => setInviting(true)}><UserPlus size={15} /> Invite people</button>}
            </>
          ) : null
        }
      />

      {noOrg ? (
        <EmptyState icon={Users2} title="You're not on a team yet" action={<Link href="/settings" className="btn btn-primary">Start or join a team</Link>}>
          A team shares one list of topics, sees each other&apos;s tracked bills, and works from a shared task board. Got an invitation email? Use its button to join.
        </EmptyState>
      ) : error && (needsUpdate || !org) ? (
        <p className="error-text">{error}</p>
      ) : loading || !org ? (
        <div className="list-skel">{[0, 1, 2].map((i) => <div key={i} className="skel skel-billrow" />)}</div>
      ) : (
        <div className="team-layout settle">
          <div className="team-main">
            <section className="card tm-people" aria-labelledby="people-title">
              <div className="tm-head">
                <h2 id="people-title" className="card-title">People</h2>
                {me && !me.full_name && <Link href="/settings" className="link-btn">Add your name so teammates know who you are</Link>}
              </div>
              <ul className="tm-list">
                {members.map((m) => {
                  const owner = m.id === ownerId;
                  const admin = isAdmin(m, ownerId);
                  return (
                    <MotionItem key={m.id}>
                      <li className="tm-row">
                        <span className="member-avatar tm-avatar" aria-hidden="true">{initialsFor(m)}</span>
                        <span className="tm-who">
                          <span className="tm-name">
                            {displayName(m)}
                            {m.id === selfId && <span className="team-rail-you">you</span>}
                            {owner && <span className="owner-badge"><Crown size={11} aria-hidden="true" /> Owner</span>}
                          </span>
                          <span className="tm-meta">{[m.job_title, m.email].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="tm-bills" title="Bills they follow">{billsBy[m.id] ?? 0} bill{(billsBy[m.id] ?? 0) === 1 ? "" : "s"}</span>
                        <span className="tm-role">
                          {amAdmin && !owner ? (
                            <select className="select select-sm" value={m.team_role} onChange={(e) => changeRole(m, e.target.value as TeamRole)} aria-label={`Role for ${displayName(m)}`} title={ROLE_HELP[m.team_role]}>
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          ) : (
                            <span className={`tm-role-badge${admin ? " is-admin" : ""}`} title={ROLE_HELP[admin ? "admin" : "member"]}>{ROLE_LABELS[admin ? "admin" : "member"]}</span>
                          )}
                        </span>
                        <span className="tm-actions">
                          {ownerId === selfId && !owner && <button className="icon-btn" onClick={() => makeOwner(m)} aria-label={`Make ${displayName(m)} the owner`} title="Make owner"><Crown size={15} /></button>}
                          {amAdmin && !owner && m.id !== selfId && <button className="icon-btn" onClick={() => removeMember(m)} aria-label={`Remove ${displayName(m)} from the team`} title="Remove from team"><X size={15} /></button>}
                        </span>
                      </li>
                    </MotionItem>
                  );
                })}
              </ul>

              {amAdmin && invites.length > 0 && (
                <>
                  <h3 className="tm-sub">Invited, not joined yet</h3>
                  <ul className="tm-list">
                    {invites.map((inv) => (
                      <MotionItem key={inv.id}>
                        <li className="tm-row is-invite">
                          <span className="member-avatar tm-avatar is-pending" aria-hidden="true"><Mail size={14} /></span>
                          <span className="tm-who">
                            <span className="tm-name">{inv.email}</span>
                            <span className="tm-meta">
                              {ROLE_LABELS[inv.role]}. {inv.last_sent_at ? `Emailed ${timeAgo(inv.last_sent_at)}` : "Not emailed (copy the link)"}, link works until {new Date(inv.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </span>
                          <span className="tm-actions tm-invite-actions">
                            <button className="icon-btn" onClick={() => copyLink(inv)} aria-label={`Copy the invitation link for ${inv.email}`} title="Copy link"><Copy size={15} /></button>
                            <button className="icon-btn" onClick={() => resend(inv)} aria-label={`Email ${inv.email} again`} title="Send again"><RotateCw size={15} /></button>
                            <button className="icon-btn" onClick={() => revoke(inv)} aria-label={`Cancel the invitation to ${inv.email}`} title="Cancel invitation"><X size={15} /></button>
                          </span>
                        </li>
                      </MotionItem>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <TeamNextActions members={members.map((m) => ({ id: m.id, email: m.email, name: displayName(m) }))} />

            {contested.length > 0 && (
              <div className="team-contested">
                <span className="team-contested-label">Team is split on</span>
                <div className="team-contested-list">
                  {contested.map((c) => (
                    <Link key={c.billId} href={`/bill/${c.billId}`} className="team-contested-chip" title={c.title}>{c.title}</Link>
                  ))}
                </div>
              </div>
            )}

            <div className="section-head">
              <h2 className="section-title">Bills the team follows <span className="count">{rows.length}</span></h2>
            </div>
            {rows.length === 0 ? (
              <EmptyState icon={Users2}>No one on your team is tracking any bills yet.</EmptyState>
            ) : (
              <BillList rows={rows} editable={false} trackerEmails={names} selfId={selfId} />
            )}
          </div>

          <aside className="team-rail">
            {amAdmin ? (
              <TeamAdminCard org={org} onChange={(o) => { setOrg(o); refreshSession(); }} />
            ) : (
              <div className="team-rail-card">
                <div className="team-rail-head"><Users2 size={14} /><span>Your role</span></div>
                <p className="settings-desc" style={{ marginTop: 8 }}>
                  You&apos;re a {me ? ROLE_LABELS[me.team_role].toLowerCase() : "member"}. {ROLE_HELP.member} Ask an admin ({members.filter((m) => isAdmin(m, ownerId)).map((m) => displayName(m)).join(", ") || "the owner"}) to invite people or change roles.
                </p>
              </div>
            )}
            <details className="team-rail-card team-rail-admin">
              <summary className="team-rail-head" style={{ cursor: "pointer" }}><span>Team logo</span></summary>
              <p className="settings-desc" style={{ marginTop: 8 }}>Shown in the sidebar for everyone.</p>
              <OrgLogoUploader orgId={org.id} currentLogoUrl={org.logo_url} onUploaded={(url) => setOrg({ ...org, logo_url: url })} />
            </details>
          </aside>
        </div>
      )}

      {inviting && org && <InviteDialog teamName={org.name} onClose={() => setInviting(false)} onSent={() => { setInviting(false); loadInvites(); }} />}
    </div>
  );
}

function TeamAdminCard({ org, onChange }: { org: Org; onChange: (o: Org) => void }) {
  const supabase = createClient();
  const { toast, confirm } = useUI();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(org.name);
  const [busy, setBusy] = useState(false);

  async function save(patch: Partial<Org>, message: string) {
    setBusy(true);
    const { error } = await supabase.from("organizations").update(patch).eq("id", org.id);
    setBusy(false);
    if (error) return toast(error.code === "23505" ? "A team with that name already exists." : error.message, "error"), false;
    onChange({ ...org, ...patch });
    toast(message, "success");
    return true;
  }

  async function newCode() {
    if (!(await confirm("Make a new invite code? The current one stops working straight away.", { confirmLabel: "New code" }))) return;
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("") + Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => "23456789"[b % 8]).join("");
    save({ invite_code: code }, "New invite code made");
  }

  return (
    <div className="team-rail-card">
      <div className="team-rail-head"><KeyRound size={14} /><span>Team settings</span></div>

      <div className="tm-setting">
        <span className="tm-setting-label">Name</span>
        {renaming ? (
          <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); if (await save({ name: name.trim() }, "Team renamed")) setRenaming(false); }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Team name" required />
            <button className="icon-btn" type="submit" disabled={busy} aria-label="Save name"><Check size={15} /></button>
          </form>
        ) : (
          <span className="tm-setting-value">{org.name} <button className="icon-btn" onClick={() => setRenaming(true)} aria-label="Rename team"><Pencil size={13} /></button></span>
        )}
      </div>

      <div className="tm-setting">
        <span className="tm-setting-label">Join with a code</span>
        <label className="switch-row">
          <input type="checkbox" className="switch" checked={org.allow_code_join} disabled={busy} onChange={(e) => save({ allow_code_join: e.target.checked }, e.target.checked ? "Anyone with the code can join" : "Joining is by email invitation only")} />
          <span>{org.allow_code_join ? "Allowed" : "Invitations only"}</span>
        </label>
        <p className="settings-desc">
          {org.allow_code_join
            ? "Anyone you give the code to can join, at sign-up or from Settings. For client data, invitations only is safer: each invitation works once, for one email address."
            : "Only people you invite by email can join."}
        </p>
        {org.allow_code_join && (
          <div className="team-rail-invite-row">
            <code className="invite-code">{org.invite_code}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(org.invite_code).then(() => toast("Code copied", "success"))}>Copy</button>
            <button className="btn btn-ghost btn-sm" onClick={newCode} disabled={busy}>New code</button>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteDialog({ teamName, onClose, onSent }: { teamName: string; onClose: () => void; onSent: () => void }) {
  const { toast } = useUI();
  const [text, setText] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [busy, setBusy] = useState(false);
  const parsed = parseEmails(text);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/team/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails: text, role }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(body.error ?? "Couldn't send invitations.", "error");
    const r = (body.results ?? []) as { email: string; status: string; note?: string }[];
    const sent = r.filter((x) => x.status === "sent").length;
    const notEmailed = r.filter((x) => x.status === "created");
    const already = r.filter((x) => x.status === "already_member").length;
    const parts = [sent && `Invited ${sent} ${sent === 1 ? "person" : "people"} by email`, already && `${already} already on the team`, notEmailed.length && `${notEmailed.length} not emailed (${notEmailed[0].note}); copy their links from the list`].filter(Boolean);
    toast(parts.join(". ") || "Done", notEmailed.length ? "info" : "success");
    animated(onSent);
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog tm-dialog" role="dialog" aria-modal="true" aria-label={`Invite people to ${teamName}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 className="dialog-title">Invite people to {teamName}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={send} className="tm-invite-form">
          <label className="field">
            Email addresses
            <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={"jane@client.org, sam@client.org\nor paste a list from your email"} autoFocus />
            <span className="field-hint">
              {parsed.emails.length ? `${parsed.emails.length} address${parsed.emails.length === 1 ? "" : "es"}` : "Separate with commas or new lines."}
              {parsed.invalid.length ? `. Can't read: ${parsed.invalid.join(", ")}` : ""}
            </span>
          </label>
          <fieldset className="tm-role-pick">
            <legend>They&apos;ll join as</legend>
            {(["member", "admin"] as TeamRole[]).map((r) => (
              <label key={r} className={`tm-role-option${role === r ? " is-on" : ""}`}>
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
                <span><strong>{ROLE_LABELS[r]}</strong><span>{ROLE_HELP[r]}</span></span>
              </label>
            ))}
          </fieldset>
          <p className="settings-desc">Each person gets an email with a button to join. The link works for 14 days, only for the address it was sent to.</p>
          <div className="db-form-actions">
            <button className="btn btn-primary" disabled={busy || !parsed.emails.length}>{busy ? "Sending…" : `Send ${parsed.emails.length > 1 ? `${parsed.emails.length} invitations` : "invitation"}`}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

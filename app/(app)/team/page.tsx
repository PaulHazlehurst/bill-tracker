"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillTable, { TableRow } from "@/components/BillTable";
import TableSkeleton from "@/components/TableSkeleton";
import OrgLogoUploader from "@/components/OrgLogoUploader";
import TeamNextActions from "@/components/TeamNextActions";
import { useUI } from "@/components/UIProvider";
import EmptyState from "@/components/EmptyState";
import { Users2, Settings2 } from "lucide-react";
import { useTicker } from "@/lib/useTicker";

type Member = { id: string; email: string };

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

export default function TeamPage() {
  const supabase = createClient();
  const { toast, confirm } = useUI();
  const router = useRouter();
  useTicker();

  const [rows, setRows] = useState<TableRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [noOrg, setNoOrg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    setSelfId(user.id);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, organizations(name, logo_url, invite_code, created_by)")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("failed to load team profile", profileError);
      setError(profileError.message);
      setLoading(false);
      return;
    }

    const oid = profile?.organization_id;
    if (!oid) {
      setNoOrg(true);
      setLoading(false);
      return;
    }
    setOrgId(oid);

    const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
    setOrgName((org as any)?.name ?? null);
    setLogoUrl((org as any)?.logo_url ?? null);
    setInviteCode((org as any)?.invite_code ?? null);
    setOwnerId((org as any)?.created_by ?? null);

    const { data: memberData, error: memberError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("organization_id", oid)
      .order("email");
    if (memberError) console.error("failed to load team members", memberError);
    setMembers((memberData as Member[]) ?? []);

    // No client-side organization_id filter here on purpose - RLS now
    // determines visibility live from each tracker's CURRENT profile (see
    // schema.sql), which is what actually fixes bills not showing up for
    // teammates. This just fetches everything RLS is willing to return.
    const { data, error: queryError } = await supabase
      .from("tracked_bills")
      .select("id, bill_id, user_id, notify_email, notify_sms, position, bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url, raw_snapshot, last_polled_at)")
      .order("created_at", { ascending: false });

    if (queryError) {
      console.error("failed to load team's tracked bills", queryError);
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setRows((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function copyCode() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1800);
    });
  }

  async function handleRemove(member: Member) {
    if (!(await confirm(`Remove ${member.email} from the team?`, { confirmLabel: "Remove", danger: true }))) return;
    setRemoving(member.id);
    const res = await fetch("/api/team/remove-member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: member.id }),
    });
    setRemoving(null);
    if (res.ok) {
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast(`Removed ${member.email}`, "success");
    } else {
      const body = await res.json().catch(() => ({}));
      toast(body.error ?? "Couldn't remove that member.", "error");
    }
  }

  const trackerEmails: Record<string, string> = {};
  members.forEach((m) => { trackerEmails[m.id] = m.email; });
  const isOwner = selfId && ownerId === selfId;

  // "Contested" - bills where teammates have taken opposing positions. This
  // is the one team statistic worth surfacing, because it's the only thing
  // here you can't see by reading the table: it needs cross-referencing
  // several people's positions on the same bill. The rest of the old
  // overview (bill counts, position donut, sponsors-by-party) was removed -
  // it duplicated the table below it and the Statistics page.
  const byBill: Record<string, TableRow[]> = {};
  rows.forEach((r) => { (byBill[r.bill_id] ??= []).push(r); });
  const contested: { billId: string; title: string }[] = [];
  Object.entries(byBill).forEach(([billId, group]) => {
    if (group.length < 2) return;
    const positions = new Set(group.map((g) => g.position).filter((p) => p !== "none"));
    if (positions.has("support") && positions.has("oppose")) {
      const bill = Array.isArray(group[0].bills) ? group[0].bills[0] : group[0].bills;
      contested.push({ billId, title: (bill as any)?.title ?? billId });
    }
  });

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Organization</span>
          <h1>{orgName ?? "Your team"}</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            What the team is working on, and everything it's tracking.
          </p>
        </div>
      </div>

      {error && !noOrg ? (
        <p className="error-text">Couldn't load your team: {error}</p>
      ) : noOrg ? (
        <p className="muted">
          You're not part of a team yet. Create or join one from <Link href="/settings">Settings</Link>.
        </p>
      ) : (
        /* Two columns: the work on the left, the people and admin tucked into
           a narrow rail on the right. The old stat grid and chart widgets are
           gone - they duplicated the table below and the Statistics page. */
        <div className="team-layout">
          <div className="team-main">
            {/* Next actions leads: it's the thing you come here to DO. */}
            <TeamNextActions members={members} />

            {/* The one cross-referenced insight worth surfacing: bills where
                teammates actively disagree. You can't see this by reading
                the table. */}
            {!loading && contested.length > 0 && (
              <div className="team-contested">
                <span className="team-contested-label">Team is split on</span>
                <div className="team-contested-list">
                  {contested.map((c) => (
                    <Link key={c.billId} href={`/bill/${c.billId}`} className="team-contested-chip" title={c.title}>
                      {c.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="table-toolbar" style={{ marginBottom: 12, marginTop: 26 }}>
              <h2 className="section-title">Tracked bills ({rows.length})</h2>
              <a href="/api/export?scope=team"><button className="ghost">Export CSV</button></a>
            </div>

            {loading ? (
              <TableSkeleton />
            ) : error ? (
              <p className="error-text">Couldn't load your team's tracked bills: {error}</p>
            ) : rows.length === 0 ? (
              <EmptyState icon={Users2}>No one on your team is tracking any bills yet.</EmptyState>
            ) : (
              <BillTable rows={rows} editable={false} trackerEmails={trackerEmails} selfId={selfId} />
            )}
          </div>

          <aside className="team-rail">
            <div className="team-rail-card">
              <div className="team-rail-head">
                <Users2 size={14} />
                <span>Members</span>
                <span className="team-rail-count">{members.length}</span>
              </div>
              <div className="team-rail-members">
                {members.map((m) => (
                  <div key={m.id} className="team-rail-member">
                    <div className="member-avatar">{initials(m.email)}</div>
                    <div className="team-rail-member-info">
                      <span className="team-rail-email" title={m.email}>{m.email}</span>
                      <span className="team-rail-tags">
                        {m.id === selfId && <span className="team-rail-you">you</span>}
                        {m.id === ownerId && <span className="owner-badge">Owner</span>}
                      </span>
                    </div>
                    {isOwner && m.id !== selfId && (
                      <button
                        className="team-rail-remove"
                        onClick={() => handleRemove(m)}
                        disabled={removing === m.id}
                        aria-label={`Remove ${m.email}`}
                        title="Remove from team"
                      >
                        {removing === m.id ? "…" : "×"}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {inviteCode && (
                <div className="team-rail-invite">
                  <span className="team-rail-invite-label">Invite code</span>
                  <div className="team-rail-invite-row">
                    <code className="invite-code">{inviteCode}</code>
                    <button className="ghost" onClick={copyCode}>{codeCopied ? "Copied" : "Copy"}</button>
                  </div>
                </div>
              )}

              {!ownerId && (
                <p className="muted" style={{ fontSize: "0.7rem", marginTop: 10 }}>
                  This team has no owner set, so no one can rename it or remove members.
                </p>
              )}
            </div>

            {orgId && (
              <details className="team-rail-card team-rail-admin">
                <summary className="team-rail-head" style={{ cursor: "pointer" }}>
                  <Settings2 size={14} />
                  <span>Team logo</span>
                </summary>
                <p className="settings-desc" style={{ marginTop: 8 }}>Shown in the sidebar for everyone.</p>
                <OrgLogoUploader orgId={orgId} currentLogoUrl={logoUrl} onUploaded={setLogoUrl} />
              </details>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

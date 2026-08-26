"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillTable, { TableRow } from "@/components/BillTable";
import TableSkeleton from "@/components/TableSkeleton";
import CountUp from "@/components/CountUp";
import ActivityMini from "@/components/ActivityMini";
import PositionBreakdown from "@/components/PositionBreakdown";
import PartyBreakdownChart from "@/components/PartyBreakdownChart";
import OrgLogoUploader from "@/components/OrgLogoUploader";
import { useUI } from "@/components/UIProvider";
import EmptyState from "@/components/EmptyState";
import { Users2 } from "lucide-react";
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

  // Team alignment stats - pure client-side aggregation of data already
  // loaded above, no extra query and definitely no extra congress.gov call.
  const byBill: Record<string, TableRow[]> = {};
  rows.forEach((r) => { (byBill[r.bill_id] ??= []).push(r); });
  const totalBills = Object.keys(byBill).length;
  let consensusCount = 0;
  let contestedCount = 0;
  const positionCounts: Record<string, number> = { support: 0, oppose: 0, watching: 0, none: 0 };
  rows.forEach((r) => { positionCounts[r.position] = (positionCounts[r.position] ?? 0) + 1; });
  // Party counts use one entry per DISTINCT bill, not per tracker row - a
  // bill tracked by three people should count once toward "sponsors by
  // party", not three times.
  const partyCounts: Record<string, number> = { D: 0, R: 0, I: 0 };
  Object.values(byBill).forEach((group) => {
    const bill = Array.isArray(group[0].bills) ? group[0].bills[0] : group[0].bills;
    const party = ((bill as any)?.raw_snapshot?.sponsors?.[0]?.party ?? "").toUpperCase();
    if (party === "D") partyCounts.D++;
    else if (party === "R") partyCounts.R++;
    else if (party) partyCounts.I++;
  });
  Object.values(byBill).forEach((group) => {
    if (group.length < 2) return;
    const positions = new Set(group.map((g) => g.position).filter((p) => p !== "none"));
    if (positions.size === 0) return;
    if (positions.has("support") && positions.has("oppose")) contestedCount++;
    else if (positions.size === 1) consensusCount++;
  });

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Organization</span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Team tracking</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {orgName ? `Everything ${orgName} is tracking.` : "Everything your team is tracking."}
          </p>
        </div>
        {inviteCode && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: '0.75rem' }}>Invite code:</span>
            <code className="invite-code">{inviteCode}</code>
            <button className="ghost" onClick={copyCode}>{codeCopied ? "Copied" : "Copy"}</button>
          </div>
        )}
      </div>

      {error && !noOrg ? (
        <p className="error-text">Couldn't load your team: {error}</p>
      ) : noOrg ? (
        <p className="muted">
          You're not part of a team yet. Create or join one from <a href="/settings">Settings</a>.
        </p>
      ) : (
        <>
          {!loading && rows.length > 0 && (
            <div className="stat-grid" style={{ marginTop: 8, marginBottom: 8 }}>
              <div className="stat-card">
                <div className="stat-value"><CountUp value={totalBills} /></div>
                <div className="stat-label">Bills tracked</div>
              </div>
              <div className="stat-card">
                <div className="stat-value"><CountUp value={members.length} /></div>
                <div className="stat-label">Team members</div>
              </div>
              <div className="stat-card">
                <div className="stat-value"><CountUp value={consensusCount} /></div>
                <div className="stat-label">Team consensus</div>
              </div>
              <div className="stat-card">
                <div className="stat-value"><CountUp value={contestedCount} /></div>
                <div className="stat-label">Contested</div>
              </div>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div className="widget-grid">
              <ActivityMini scope="team" />
              <PositionBreakdown counts={positionCounts} />
              {(partyCounts.D > 0 || partyCounts.R > 0 || partyCounts.I > 0) && (
                <div className="card">
                  <PartyBreakdownChart counts={partyCounts} title="Sponsors by party" />
                </div>
              )}
            </div>
          )}

          {!loading && orgId && (
            <div className="settings-section" style={{ marginTop: 24 }}>
              <h2>Team logo</h2>
              <p className="settings-desc">Shown in the sidebar for everyone in your organization.</p>
              <OrgLogoUploader orgId={orgId} currentLogoUrl={logoUrl} onUploaded={setLogoUrl} />
            </div>
          )}

          {!loading && members.length > 0 && (
            <div className="settings-section">
              <h2>Team members ({members.length})</h2>
              <div className="card">
                <div className="member-list">
                  {members.map((m) => (
                    <div key={m.id} className="member-row">
                      <div className="member-avatar">{initials(m.email)}</div>
                      <span style={{ flex: 1 }}>
                        {m.email}
                        {m.id === selfId && <span className="muted"> (you)</span>}
                        {m.id === ownerId && <span className="owner-badge">Owner</span>}
                      </span>
                      {isOwner && m.id !== selfId && (
                        <button className="ghost" style={{ fontSize: '0.6875rem', padding: "4px 8px" }} onClick={() => handleRemove(m)} disabled={removing === m.id}>
                          {removing === m.id ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {!ownerId && <p className="muted" style={{ marginTop: 8 }}>This team has no owner set, so no one can rename it or remove members right now.</p>}
            </div>
          )}

          <div className="table-toolbar" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: '1.0625rem', fontWeight: 500, margin: 0 }}>Tracked bills ({rows.length})</h2>
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
        </>
      )}
    </div>
  );
}

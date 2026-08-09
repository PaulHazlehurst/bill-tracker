"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillTable, { TableRow } from "@/components/BillTable";
import Spinner from "@/components/Spinner";
import OrgLogoUploader from "@/components/OrgLogoUploader";
import { useUI } from "@/components/UIProvider";
import EmptyState from "@/components/EmptyState";
import { Users2 } from "lucide-react";

type Member = { id: string; email: string };

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

export default function TeamPage() {
  const supabase = createClient();
  const { toast, confirm } = useUI();
  const router = useRouter();
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, organizations(name, logo_url, invite_code, created_by)")
      .eq("id", user.id)
      .single();

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

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
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

      {noOrg ? (
        <p className="muted">
          You're not part of a team yet. Create or join one from <a href="/settings">Settings</a>.
        </p>
      ) : (
        <>
          {!loading && orgId && (
            <div className="settings-section">
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
            <Spinner label="Loading your team's tracked bills…" />
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

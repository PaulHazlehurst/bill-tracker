"use client";

// These pages depend on the signed-in user's session, which only exists at
// request time - there's no sensible static/build-time version of them.
// This tells Next.js to render on each request instead of trying to
// pre-build static HTML (which would run before any Supabase session exists).
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillCard, { TrackedBillRow } from "@/components/BillCard";
import NavBar from "@/components/NavBar";
import Spinner from "@/components/Spinner";
import OrgLogoUploader from "@/components/OrgLogoUploader";

type TeamRow = TrackedBillRow & { user_id: string };
type Member = { id: string; email: string };

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

export default function TeamPage() {
  const supabase = createClient();
  const router = useRouter();
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [noOrg, setNoOrg] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setSelfId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, organizations(name, logo_url)")
        .eq("id", user.id)
        .single();

      const orgId = profile?.organization_id;
      if (!orgId) {
        setNoOrg(true);
        setLoading(false);
        return;
      }
      setOrgId(orgId);

      const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
      setOrgName((org as any)?.name ?? null);
      setLogoUrl((org as any)?.logo_url ?? null);

      // Who's on the team, including yourself.
      const { data: memberData, error: memberError } = await supabase
        .from("profiles")
        .select("id, email")
        .eq("organization_id", orgId)
        .order("email");
      if (memberError) console.error("failed to load team members", memberError);
      setMembers((memberData as Member[]) ?? []);

      // RLS already scopes this to the caller's org - no need to filter
      // client-side, but doing so anyway keeps intent explicit.
      // NOTE: this intentionally does NOT try to embed profiles(email) here -
      // there's no foreign key between tracked_bills and profiles for
      // PostgREST to use, so that embed silently fails the whole query.
      // Instead we fetch user_id and match it against `members` above.
      const { data, error: queryError } = await supabase
        .from("tracked_bills")
        .select(
          "id, bill_id, user_id, notify_email, notify_sms, bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url, raw_snapshot, last_polled_at)"
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (queryError) {
        console.error("failed to load team's tracked bills", queryError);
        setError(queryError.message);
        setLoading(false);
        return;
      }

      setRows((data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <NavBar />
      <div className="container">
        <h1 style={{ fontSize: '1.375rem', fontWeight: 500 }}>Team tracking</h1>

        {noOrg ? (
          <p className="muted">
            You're not part of an organization yet. Join one from your profile to see what your team is tracking.
          </p>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 20 }}>
              {orgName ? `Everything ${orgName} is tracking.` : "Everything your team is tracking."}
            </p>

            {!loading && orgId && (
              <div className="settings-section">
                <h2>Team settings</h2>
                <p className="settings-desc">Upload a logo for your team. Shown in the header for everyone in your organization.</p>
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
                        <span>{m.email}</span>
                        {m.id === selfId && <span className="muted">(you)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>Tracked bills ({rows.length})</h2>
              <a href="/api/export?scope=team"><button className="ghost">Export CSV</button></a>
            </div>

            {loading ? (
              <Spinner label="Loading your team's tracked bills…" />
            ) : error ? (
              <p className="error-text">Couldn't load your team's tracked bills: {error}</p>
            ) : rows.length === 0 ? (
              <p className="muted">No one on your team is tracking any bills yet.</p>
            ) : (
              rows.map((row, i) => {
                const trackerEmail = members.find((m) => m.id === row.user_id)?.email;
                return (
                  <div key={`${row.bill_id}-${i}`}>
                    {trackerEmail && (
                      <div className="muted" style={{ marginBottom: 4 }}>
                        Added by {trackerEmail}{row.user_id === selfId ? " (you)" : ""}
                      </div>
                    )}
                    <BillCard row={row} editable={false} index={i} />
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}

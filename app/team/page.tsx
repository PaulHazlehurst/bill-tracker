"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillCard, { TrackedBillRow } from "@/components/BillCard";
import NavBar from "@/components/NavBar";

type TeamRow = TrackedBillRow & { profiles: { email: string } | { email: string }[] | null };

export default function TeamPage() {
  const supabase = createClient();
  const router = useRouter();
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [noOrg, setNoOrg] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, organizations(name)")
        .eq("id", user.id)
        .single();

      const orgId = profile?.organization_id;
      if (!orgId) {
        setNoOrg(true);
        setLoading(false);
        return;
      }

      const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
      setOrgName((org as any)?.name ?? null);

      // RLS already scopes this to the caller's org - no need to filter
      // client-side, but doing so anyway keeps intent explicit.
      const { data } = await supabase
        .from("tracked_bills")
        .select(
          "bill_id, notify_email, notify_sms, profiles(email), bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url)"
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      setRows((data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <NavBar />
      <div className="container">
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Team tracking</h1>

        {noOrg ? (
          <p className="muted">
            You're not part of an organization yet. Join one from your profile to see what your team is tracking.
          </p>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 20 }}>
              {orgName ? `Everything ${orgName} is tracking.` : "Everything your team is tracking."}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <a href="/api/export?scope=team"><button className="ghost">Export CSV</button></a>
            </div>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="muted">No one on your team is tracking any bills yet.</p>
            ) : (
              rows.map((row, i) => {
                const trackerEmail = Array.isArray(row.profiles) ? row.profiles[0]?.email : row.profiles?.email;
                return (
                  <div key={`${row.bill_id}-${i}`}>
                    {trackerEmail && (
                      <div className="muted" style={{ marginBottom: 4 }}>Added by {trackerEmail}</div>
                    )}
                    <BillCard row={row} editable={false} />
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

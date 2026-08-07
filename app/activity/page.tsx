"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NavBar from "@/components/NavBar";
import Spinner from "@/components/Spinner";
import { formatDate, timeAgo } from "@/lib/billMeta";

type ActivityRow = {
  id: string;
  bill_id: string;
  summary: string;
  occurred_at: string;
  bills: { title: string } | { title: string }[] | null;
};

export default function ActivityPage() {
  const supabase = createClient();
  const router = useRouter();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .single();

      // Every bill this person or their team tracks - activity is scoped to
      // "things relevant to you", not the whole platform's event stream.
      let billIdsQuery = supabase.from("tracked_bills").select("bill_id").eq("user_id", user.id);
      const { data: personalTracked } = await billIdsQuery;

      let teamTracked: { bill_id: string }[] = [];
      if (profile?.organization_id) {
        const { data } = await supabase.from("tracked_bills").select("bill_id").eq("organization_id", profile.organization_id);
        teamTracked = data ?? [];
      }

      const billIds = Array.from(new Set([...(personalTracked ?? []), ...teamTracked].map((r) => r.bill_id)));

      if (billIds.length === 0) {
        setLoading(false);
        return;
      }

      const { data, error: queryError } = await supabase
        .from("bill_events")
        .select("id, bill_id, summary, occurred_at, bills(title)")
        .in("bill_id", billIds)
        .order("occurred_at", { ascending: false })
        .limit(50);

      if (queryError) {
        console.error("failed to load activity", queryError);
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
        <h1 style={{ fontSize: '1.375rem', fontWeight: 500 }}>Activity</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Every recorded change to a bill you or your team tracks, most recent first.
        </p>

        {loading ? (
          <Spinner label="Loading activity…" />
        ) : error ? (
          <p className="error-text">Couldn't load activity: {error}</p>
        ) : rows.length === 0 ? (
          <p className="muted">
            No activity yet. This fills in automatically as the daily check detects changes to bills you're tracking.
          </p>
        ) : (
          <div className="member-list">
            {rows.map((row) => {
              const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
              return (
                <div key={row.id} className="member-row" style={{ alignItems: "flex-start", padding: "14px 0" }}>
                  <div className="member-avatar" style={{ marginTop: 2 }}>•</div>
                  <div style={{ minWidth: 0 }}>
                    {bill?.title && (
                      <a href={`/bill/${row.bill_id}`} style={{ fontSize: '0.875rem', fontWeight: 500, textDecoration: "none" }}>
                        {bill.title}
                      </a>
                    )}
                    <div style={{ fontSize: '0.8125rem', marginTop: 2 }}>{row.summary}</div>
                    <div className="muted" style={{ fontSize: '0.6875rem', marginTop: 2 }}>
                      {timeAgo(row.occurred_at)} · {formatDate(row.occurred_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import EmptyState from "@/components/EmptyState";
import { Activity as ActivityIcon } from "lucide-react";
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

      // No filter needed here - RLS on tracked_bills already returns exactly
      // "my own rows, plus anyone whose CURRENT org matches mine" (see
      // schema.sql). Same fix as the team page: don't re-derive that scoping
      // with a stale organization_id column, just let RLS do it live.
      const { data: allTracked } = await supabase.from("tracked_bills").select("bill_id");
      const billIds = Array.from(new Set((allTracked ?? []).map((r) => r.bill_id)));

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
    <div className="container-wide">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Activity</h1>
          <p className="muted" style={{ marginTop: 4 }}>Every recorded change to a bill you or your team tracks, most recent first.</p>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading activity…" />
      ) : error ? (
        <p className="error-text">Couldn't load activity: {error}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ActivityIcon}>
          No activity yet. This fills in automatically as the daily check detects changes to bills you're tracking.
        </EmptyState>
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
  );
}

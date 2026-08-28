"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo, EVENT_TYPE_ICONS } from "@/lib/billMeta";
import { TrendingUp, FileText, Users, Circle } from "lucide-react";

const ICONS: Record<string, any> = { "trending-up": TrendingUp, "file-text": FileText, "users": Users };

type Row = {
  id: string;
  bill_id: string;
  event_type: string;
  summary: string;
  occurred_at: string;
  bills: { title: string } | { title: string }[] | null;
};

// Self-contained: fetches its own small slice of recent activity, scoped
// to either "personal" (your tracked bills) or "team" (everything your org
// tracks, via the same live-org RLS as the team page - see schema.sql).
// This is pure Supabase querying, no congress.gov calls, so showing it on
// the dashboard costs nothing against the API rate limit.
export default function ActivityMini({ scope, limit = 5 }: { scope: "personal" | "team"; limit?: number }) {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let billIdsQuery = supabase.from("tracked_bills").select("bill_id").eq("user_id", user.id);
      if (scope === "team") {
        // RLS already returns "my own rows + anyone whose current org
        // matches mine" - no client filter needed, see schema.sql.
        billIdsQuery = supabase.from("tracked_bills").select("bill_id");
      }
      const { data: tracked } = await billIdsQuery;
      const billIds = Array.from(new Set((tracked ?? []).map((r) => r.bill_id)));

      if (billIds.length === 0) {
        setRows([]);
        return;
      }

      const { data } = await supabase
        .from("bill_events")
        .select("id, bill_id, event_type, summary, occurred_at, bills(title)")
        .in("bill_id", billIds)
        .order("occurred_at", { ascending: false })
        .limit(limit);

      setRows((data as any) ?? []);
    })();
  }, [scope]);

  if (rows === null) return null; // don't flash an empty widget before the first fetch resolves
  if (rows.length === 0) return null; // nothing to show yet - let the page's own empty state handle messaging

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, margin: 0 }}>Recent activity</h2>
        <Link href="/activity" className="muted" style={{ fontSize: '0.75rem' }}>See all →</Link>
      </div>
      <div>
        {rows.map((row) => {
          const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
          const Icon = ICONS[EVENT_TYPE_ICONS[row.event_type]] ?? Circle;
          return (
            <div key={row.id} className="activity-mini-row">
              <Icon size={13} className="muted" style={{ flexShrink: 0, marginTop: 3 }} />
              <div style={{ minWidth: 0 }}>
                {bill?.title && (
                  <Link href={`/bill/${row.bill_id}`} style={{ fontSize: '0.8125rem', fontWeight: 500, textDecoration: "none" }}>
                    {bill.title.length > 60 ? bill.title.slice(0, 60) + "…" : bill.title}
                  </Link>
                )}
                <div className="muted" style={{ fontSize: '0.75rem' }}>{row.summary}</div>
                <div className="muted" style={{ fontSize: '0.6875rem' }}>{timeAgo(row.occurred_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

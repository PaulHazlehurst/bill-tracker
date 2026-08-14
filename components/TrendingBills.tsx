"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TrendingUp } from "lucide-react";

type Row = {
  bill_id: string;
  cosponsor_delta: number;
  occurred_at: string;
  bills: { title: string } | { title: string }[] | null;
};

// Shows which of YOUR tracked bills are gaining cosponsors fastest over the
// last 14 days - a real momentum signal, not a guess, built entirely from
// cosponsor_delta values the poller already writes (see schema.sql). Zero
// extra congress.gov calls; this is pure Supabase aggregation of data
// that's already being collected for other features.
export default function TrendingBills() {
  const supabase = createClient();
  const [rows, setRows] = useState<{ billId: string; title: string; total: number }[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: tracked } = await supabase.from("tracked_bills").select("bill_id").eq("user_id", user.id);
      const billIds = Array.from(new Set((tracked ?? []).map((r) => r.bill_id)));
      if (billIds.length === 0) {
        setRows([]);
        return;
      }

      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("bill_events")
        .select("bill_id, cosponsor_delta, occurred_at, bills(title)")
        .in("bill_id", billIds)
        .eq("event_type", "cosponsor_change")
        .gte("occurred_at", fourteenDaysAgo)
        .not("cosponsor_delta", "is", null);

      const totals: Record<string, { title: string; total: number }> = {};
      for (const row of (data as Row[]) ?? []) {
        const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
        if (!totals[row.bill_id]) totals[row.bill_id] = { title: bill?.title ?? row.bill_id, total: 0 };
        totals[row.bill_id].total += row.cosponsor_delta;
      }

      const ranked = Object.entries(totals)
        .map(([billId, v]) => ({ billId, ...v }))
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      setRows(ranked);
    })();
  }, []);

  if (rows === null || rows.length === 0) return null;

  return (
    <div className="card">
      <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 4 }}>Trending in your bills</h2>
      <p className="settings-desc">Fastest cosponsor growth, last 14 days.</p>
      <div>
        {rows.map((r, i) => (
          <div key={r.billId} className="trending-row">
            <span className="trending-rank">{i + 1}</span>
            <a href={`/bill/${r.billId}`} className="trending-title">{r.title}</a>
            <span className="trending-delta">
              <TrendingUp size={12} /> +{r.total}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

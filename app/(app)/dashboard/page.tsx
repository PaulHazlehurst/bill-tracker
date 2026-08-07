"use client";

// Session-dependent - no static version of "your tracked bills" makes sense.
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillTable, { TableRow } from "@/components/BillTable";
import BillSearch from "@/components/BillSearch";
import Spinner from "@/components/Spinner";
import { STAGE_LABELS } from "@/lib/billMeta";

export default function DashboardPage() {
  const supabase = createClient();
  const router = useRouter();
  const [tracked, setTracked] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [search, setSearch] = useState("");

  async function loadTracked() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data, error: queryError } = await supabase
      .from("tracked_bills")
      .select("id, bill_id, notify_email, notify_sms, position, bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url, raw_snapshot, last_polled_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (queryError) {
      console.error("failed to load tracked bills", queryError);
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setError(null);
    setTracked((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadTracked();
  }, []);

  async function handleUntrack(trackedBillId: string) {
    const res = await fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(trackedBillId)}`, { method: "DELETE" });
    if (res.ok) setTracked((prev) => prev.filter((r) => r.id !== trackedBillId));
    else window.alert("Couldn't untrack that bill - try again.");
  }

  async function handleBulkUntrack(ids: string[]) {
    await Promise.all(ids.map((id) => fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(id)}`, { method: "DELETE" })));
    setTracked((prev) => prev.filter((r) => !ids.includes(r.id)));
  }

  const counts = { active: 0, committee: 0, passed: 0, enacted: 0 };
  tracked.forEach((row) => {
    const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
    const stage = bill?.status_stage;
    if (!stage) return;
    if (stage === "enacted") counts.enacted++;
    else if (stage === "passed_house" || stage === "passed_senate" || stage === "to_president") counts.passed++;
    else if (stage === "committee") counts.committee++;
    else counts.active++;
  });

  const filtered = tracked
    .filter((row) => {
      const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
      if (stageFilter !== "all" && bill?.status_stage !== stageFilter) return false;
      if (positionFilter !== "all" && row.position !== positionFilter) return false;
      if (search.trim() && !bill?.title?.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const billA = Array.isArray(a.bills) ? a.bills[0] : a.bills;
      const billB = Array.isArray(b.bills) ? b.bills[0] : b.bills;
      if (sortBy === "title") return (billA?.title ?? "").localeCompare(billB?.title ?? "");
      if (sortBy === "progress") return (billB?.progress_pct ?? 0) - (billA?.progress_pct ?? 0);
      return 0;
    });

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Your tracked bills</h1>
          <p className="muted" style={{ marginTop: 4 }}>Search for a bill below to start tracking it.</p>
        </div>
      </div>

      <BillSearch onTracked={loadTracked} />

      {!loading && !error && tracked.length > 0 && (
        <div className="stat-grid" style={{ marginTop: 24 }}>
          {[
            { label: "Introduced", value: counts.active },
            { label: "In committee", value: counts.committee },
            { label: "Passed a chamber", value: counts.passed },
            { label: "Enacted", value: counts.enacted },
          ].map((s) => (
            <div key={s.label} className="stat-card">
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <div className="table-toolbar">
          <h2 style={{ fontSize: '1.0625rem', fontWeight: 500, margin: 0 }}>Currently tracking ({filtered.length})</h2>
          <div className="table-toolbar-controls">
            <input
              type="search"
              placeholder="Filter by title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="toolbar-input"
            />
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="toolbar-select">
              <option value="all">All stages</option>
              {Object.entries(STAGE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} className="toolbar-select">
              <option value="all">All positions</option>
              <option value="support">Support</option>
              <option value="oppose">Oppose</option>
              <option value="watching">Watching</option>
              <option value="none">No position</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="toolbar-select">
              <option value="newest">Newest tracked</option>
              <option value="title">Title (A-Z)</option>
              <option value="progress">Most progress</option>
            </select>
            <a href="/api/export?scope=personal"><button className="ghost">Export all</button></a>
          </div>
        </div>

        {error ? (
          <p className="error-text">Couldn't load your tracked bills: {error}</p>
        ) : loading ? (
          <Spinner label="Loading your tracked bills…" />
        ) : tracked.length === 0 ? (
          <p className="muted">Nothing tracked yet — search for a bill above to add one.</p>
        ) : filtered.length === 0 ? (
          <p className="muted">No tracked bills match those filters.</p>
        ) : (
          <BillTable rows={filtered} editable onUntrack={handleUntrack} onBulkUntrack={handleBulkUntrack} />
        )}
      </div>
    </div>
  );
}

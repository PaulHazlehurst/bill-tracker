"use client";

// Session-dependent - no static version of "your tracked bills" makes sense.
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillTable, { TableRow } from "@/components/BillTable";
import BillSearch from "@/components/BillSearch";
import Spinner from "@/components/Spinner";
import TableSkeleton from "@/components/TableSkeleton";
import ActivityMini from "@/components/ActivityMini";
import PositionBreakdown from "@/components/PositionBreakdown";
import PartyBreakdownChart from "@/components/PartyBreakdownChart";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import FirstRunHero from "@/components/FirstRunHero";
import Reveal from "@/components/Reveal";
import TrendingBills from "@/components/TrendingBills";
import { useUI } from "@/components/UIProvider";
import RadialProgress from "@/components/RadialProgress";
import StageFlow from "@/components/StageFlow";
import { STAGE_LABELS } from "@/lib/billMeta";
import { getRecentlyViewed, RecentBill } from "@/lib/recentlyViewed";
import { useTicker } from "@/lib/useTicker";

export default function DashboardPage() {
  const supabase = createClient();
  const { toast } = useUI();
  const router = useRouter();
  useTicker(); // keeps "Checked Xm ago" style timestamps fresh without a reload

  const [tracked, setTracked] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [search, setSearch] = useState("");
  const [recentlyViewed, setRecentlyViewed] = useState<RecentBill[]>([]);
  const [hasTeam, setHasTeam] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [hasEmailEnabled, setHasEmailEnabled] = useState(false);
  const [weeklyActivityCount, setWeeklyActivityCount] = useState<number | null>(null);

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

    // For the onboarding checklist - a small, separate query rather than
    // complicating the select above with a join that isn't otherwise needed.
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, phone, email_notifications_enabled")
      .eq("id", user.id)
      .single();
    setHasTeam(!!profile?.organization_id);
    setHasPhone(!!profile?.phone);
    setHasEmailEnabled(!!profile?.email_notifications_enabled);
  }

  useEffect(() => {
    loadTracked();
    setRecentlyViewed(getRecentlyViewed());
    loadWeeklyActivityCount();
  }, []);

  async function loadWeeklyActivityCount() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: myBills } = await supabase.from("tracked_bills").select("bill_id").eq("user_id", user.id);
    const billIds = Array.from(new Set((myBills ?? []).map((r) => r.bill_id)));
    if (billIds.length === 0) {
      setWeeklyActivityCount(0);
      return;
    }
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("bill_events")
      .select("id", { count: "exact", head: true })
      .in("bill_id", billIds)
      .gte("occurred_at", weekAgo);
    setWeeklyActivityCount(count ?? 0);
  }

  async function handleUntrack(trackedBillId: string) {
    const res = await fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(trackedBillId)}`, { method: "DELETE" });
    if (res.ok) {
      setTracked((prev) => prev.filter((r) => r.id !== trackedBillId));
      toast("Stopped tracking", "info");
    } else {
      toast("Couldn't untrack that bill - try again.", "error");
    }
  }

  async function handleBulkUntrack(ids: string[]) {
    await Promise.all(ids.map((id) => fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(id)}`, { method: "DELETE" })));
    setTracked((prev) => prev.filter((r) => !ids.includes(r.id)));
    toast(`Stopped tracking ${ids.length} bill${ids.length > 1 ? "s" : ""}`, "info");
  }

  const counts = { active: 0, committee: 0, passed: 0, enacted: 0 };
  const positionCounts: Record<string, number> = { support: 0, oppose: 0, watching: 0, none: 0 };
  const partyCounts: Record<string, number> = { D: 0, R: 0, I: 0 };
  tracked.forEach((row) => {
    const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
    const stage = bill?.status_stage;
    positionCounts[row.position] = (positionCounts[row.position] ?? 0) + 1;
    const sponsorParty = (bill?.raw_snapshot?.sponsors?.[0]?.party ?? "").toUpperCase();
    if (sponsorParty === "D") partyCounts.D++;
    else if (sponsorParty === "R") partyCounts.R++;
    else if (sponsorParty) partyCounts.I++;
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
      {!loading && tracked.length === 0 ? (
        <FirstRunHero onTracked={loadTracked} />
      ) : (
        <>
          <div className="page-header">
            <div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Your tracked bills</h1>
              <p className="muted" style={{ marginTop: 4 }}>Search for a bill below to start tracking it.</p>
            </div>
          </div>

          {!loading && (
            <OnboardingChecklist hasTrackedBill={tracked.length > 0} hasEmailEnabled={hasEmailEnabled} hasTeam={hasTeam} hasPhone={hasPhone} />
          )}
        </>
      )}

      <BillSearch onTracked={loadTracked} />

      {!loading && !error && tracked.length > 0 && (
        <Reveal>
          <div className="settings-section overview-section">
            <p className="overview-narrative">
              You're tracking <strong>{tracked.length}</strong> bill{tracked.length !== 1 ? "s" : ""}
              {counts.enacted > 0 && <> — <strong>{counts.enacted}</strong> {counts.enacted === 1 ? "has" : "have"} become law</>}
              {counts.committee > 0 && <>, <strong>{counts.committee}</strong> in committee</>}
              {weeklyActivityCount !== null && weeklyActivityCount > 0 && (
                <> · <strong>{weeklyActivityCount}</strong> update{weeklyActivityCount > 1 ? "s" : ""} this week</>
              )}.
            </p>

            <div className="overview-featured">
              <div className="overview-featured-ring">
                <RadialProgress
                  percent={tracked.length > 0 ? (counts.enacted / tracked.length) * 100 : 0}
                  size={92}
                  color="var(--pos-support)"
                  label="Reached law"
                />
              </div>
              <div className="overview-stage-flow-wrap">
                <StageFlow counts={counts} />
              </div>
            </div>

            <div className="bento-grid">
              <div className="bento-cell bento-activity">
                <ActivityMini scope="personal" />
              </div>
              <div className="bento-cell bento-trending">
                <TrendingBills />
              </div>
              <div className="bento-cell bento-position">
                <PositionBreakdown counts={positionCounts} />
              </div>
              {(partyCounts.D > 0 || partyCounts.R > 0 || partyCounts.I > 0) && (
                <div className="bento-cell bento-party">
                  <PartyBreakdownChart counts={partyCounts} title="Sponsors by party" />
                </div>
              )}
            </div>
          </div>
        </Reveal>
      )}

      {recentlyViewed.length > 0 && (
        <Reveal delay={80}>
          <div className="settings-section" style={{ marginTop: 24 }}>
            <h2>Recently viewed</h2>
            <div className="recent-viewed-chips">
              {recentlyViewed.map((r) => (
                <a key={r.billId} href={`/bill/${r.billId}`} className="recent-viewed-chip" title={r.title}>{r.title}</a>
              ))}
            </div>
          </div>
        </Reveal>
      )}

      {(loading || tracked.length > 0) && (
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
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <p className="muted">No tracked bills match those filters.</p>
        ) : (
          <BillTable rows={filtered} editable onUntrack={handleUntrack} onBulkUntrack={handleBulkUntrack} />
        )}
      </div>
      )}
    </div>
  );
}

"use client";

// Session-dependent - no static version of "your tracked bills" makes sense.
export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillTable, { TableRow } from "@/components/BillTable";
import BillSearch from "@/components/BillSearch";
import TableSkeleton from "@/components/TableSkeleton";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import FirstRunHero from "@/components/FirstRunHero";
import Reveal from "@/components/Reveal";
import TopicsHero from "@/components/TopicsHero";
import ProspectiveBills from "@/components/ProspectiveBills";
import { useUI } from "@/components/UIProvider";
import { useSession } from "@/components/SessionProvider";
import { STAGE_LABELS } from "@/lib/billMeta";
import { getRecentlyViewed, RecentBill } from "@/lib/recentlyViewed";
import { useTicker } from "@/lib/useTicker";

export default function DashboardPage() {
  const supabase = createClient();
  const { toast } = useUI();
  const router = useRouter();
  useTicker(); // keeps "Checked Xm ago" style timestamps fresh without a reload

  // Identity from the shared session - the dashboard no longer runs its own
  // auth or profile queries (it previously did three of each per load).
  const { userId, profile, loading: sessionLoading } = useSession();
  const hasTeam = !!profile?.organization_id;
  const hasPhone = !!profile?.phone;
  const hasEmailEnabled = !!profile?.email_notifications_enabled;

  const [tracked, setTracked] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [search, setSearch] = useState("");
  const [recentlyViewed, setRecentlyViewed] = useState<RecentBill[]>([]);
  const [prospectiveRefreshKey, setProspectiveRefreshKey] = useState(0);

  async function loadTracked() {
    if (!userId) return;
    // NOTE on raw_snapshot: it's a large JSON blob and it would be nice not to
    // fetch it here, but BillTable reads the sponsor name out of it for the
    // Sponsor column, so dropping it would blank that column for every row.
    // The real fix is a scalar `sponsor_name` column on bills written by the
    // poller; until that exists (and is backfilled), fetching the blob is the
    // honest trade. The heavy lifting for dashboard speed is done by the
    // indexes in supabase/add-performance-indexes.sql and by no longer
    // running duplicate auth/profile/tracked_bills queries on this page.
    const { data, error: queryError } = await supabase
      .from("tracked_bills")
      .select("id, bill_id, notify_email, notify_sms, position, bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url, raw_snapshot, last_polled_at)")
      .eq("user_id", userId)
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
    setRecentlyViewed(getRecentlyViewed());
  }, []);

  // Wait for the session before querying - and redirect out if there's no user.
  useEffect(() => {
    if (sessionLoading) return;
    if (!userId) {
      router.push("/login");
      return;
    }
    loadTracked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, userId]);

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
          {!loading && (
            <OnboardingChecklist hasTrackedBill={tracked.length > 0} hasEmailEnabled={hasEmailEnabled} hasTeam={hasTeam} hasPhone={hasPhone} />
          )}
        </>
      )}

      {/* Topic-based discovery: "what might you be missing?" sits above
          the tracked-bills table so it's always visible without navigating
          to a separate page. TopicsHero manages keywords; ProspectiveBills
          shows the bills those keywords matched. */}
      {!loading && (
        <Reveal>
          <TopicsHero onDiscovered={() => setProspectiveRefreshKey((k) => k + 1)} />
          <ProspectiveBills key={prospectiveRefreshKey} onTracked={() => { loadTracked(); setProspectiveRefreshKey((k) => k + 1); }} />
        </Reveal>
      )}

      <BillSearch onTracked={loadTracked} />

      {/* The portfolio stat strip ("8 Tracking · 6 In committee" + stage bar
          + collapsible analytics) used to sit here. Removed deliberately: it
          repeated numbers you can already read off the list below it, and
          every chart it hid behind "More detail" already lives, in more depth,
          on the Statistics and Activity pages. Dropping it also let the
          dashboard stop fetching each bill's full raw_snapshot JSON blob,
          which was the single heaviest query on the page. */}

      {(loading || tracked.length > 0) && (
      <div style={{ marginTop: 28 }}>
        <div className="table-toolbar">
          <h2 className="section-title">Currently tracking ({filtered.length})</h2>
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
            <Link href="/statistics"><button className="ghost">Analytics</button></Link>
            <a href="/api/export?scope=personal"><button className="ghost">Export all</button></a>
          </div>
        </div>

        {error ? (
          <p className="error-text">Couldn't load your tracked bills: {error}</p>
        ) : loading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="dash-nomatch">
            <p className="muted" style={{ margin: 0 }}>No tracked bills match those filters.</p>
            <button
              className="ghost"
              onClick={() => { setSearch(""); setStageFilter("all"); setPositionFilter("all"); }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <BillTable rows={filtered} editable onUntrack={handleUntrack} onBulkUntrack={handleBulkUntrack} />
        )}
      </div>
      )}

      {/* Recently viewed moved BELOW the table. It used to sit between the
          search box and the tracked list, interrupting the main flow with
          secondary information; as a quiet footer strip it's still one click
          away without competing for attention. */}
      {recentlyViewed.length > 0 && (
        <Reveal delay={80}>
          <div className="dash-recent">
            <span className="dash-recent-label">Recently viewed</span>
            <div className="recent-viewed-chips">
              {recentlyViewed.map((r) => (
                <Link key={r.billId} href={`/bill/${r.billId}`} className="recent-viewed-chip" title={r.title}>{r.title}</Link>
              ))}
            </div>
          </div>
        </Reveal>
      )}
    </div>
  );
}

"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillList, { TableRow, billOf, downloadCsv, QUIET_DAYS } from "@/components/BillList";
import CatchUp from "@/components/CatchUp";
import DiscoverPanel from "@/components/DiscoverPanel";
import FirstRunHero from "@/components/FirstRunHero";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import RegulationsTeaser from "@/components/RegulationsTeaser";
import PageHeader from "@/components/ui/PageHeader";
import { useUI } from "@/components/UIProvider";
import { useSession } from "@/components/SessionProvider";
import { STAGE_LABELS, STAGE_ORDER } from "@/lib/billStage";
import { daysSince, citationFor } from "@/lib/billMeta";
import { fetchEvents, readAndMarkVisit, type BillEventRow } from "@/lib/events";
import { getRecentlyViewed, RecentBill } from "@/lib/recentlyViewed";
import { useTicker } from "@/lib/useTicker";
import { Download, BarChart3, Search } from "lucide-react";

const SORTS: Record<string, string> = {
  active: "Latest activity",
  newest: "Newest tracked",
  furthest: "Furthest along",
  title: "Title A–Z",
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const supabase = createClient();
  const { toast } = useUI();
  const router = useRouter();
  useTicker();

  const { userId, profile, loading: sessionLoading } = useSession();
  const [tracked, setTracked] = useState<TableRow[]>([]);
  const [events, setEvents] = useState<BillEventRow[]>([]);
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState("all");
  const [position, setPosition] = useState("all");
  const [quietOnly, setQuietOnly] = useState(false);
  const [sortBy, setSortBy] = useState("active");
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<RecentBill[]>([]);
  const [firstPaint, setFirstPaint] = useState(true);

  async function loadTracked() {
    if (!userId) return;
    const { data, error: queryError } = await supabase
      .from("tracked_bills")
      .select("id, bill_id, notify_email, notify_sms, position, created_at, bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url, raw_snapshot, last_polled_at)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }
    const rows = ((data as any) ?? []) as TableRow[];
    setError(null);
    setTracked(rows);
    setLoading(false);

    const ids = rows.map((r) => r.bill_id);
    const since = new Date(Date.now() - 15 * 86_400_000).toISOString();
    const { rows: ev } = await fetchEvents(supabase, { billIds: ids, since, limit: 400 });
    setEvents(ev);
  }

  useEffect(() => {
    setRecent(getRecentlyViewed());
    setLastVisit(readAndMarkVisit());
    const t = setTimeout(() => setFirstPaint(false), 1600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    if (!userId) {
      router.push("/login");
      return;
    }
    loadTracked();
    // Bills tracked from the top bar's dialog or the command palette.
    const onTracked = () => loadTracked();
    window.addEventListener("bt:tracked", onTracked);
    return () => window.removeEventListener("bt:tracked", onTracked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, userId]);

  async function untrack(id: string) {
    const res = await fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      setTracked((prev) => prev.filter((r) => r.id !== id));
      toast("Stopped tracking", "info");
    } else toast("Couldn't stop tracking that bill. Try again.", "error");
  }

  async function bulkUntrack(ids: string[]) {
    const results = await Promise.all(ids.map((id) => fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(id)}`, { method: "DELETE" })));
    const ok = ids.filter((_, i) => results[i].ok);
    setTracked((prev) => prev.filter((r) => !ok.includes(r.id)));
    toast(ok.length === ids.length ? `Stopped tracking ${ok.length} bill${ok.length > 1 ? "s" : ""}` : `Stopped ${ok.length} of ${ids.length}. Try the rest again.`, ok.length === ids.length ? "info" : "error");
  }

  const titles = useMemo(() => {
    const t: Record<string, string> = {};
    for (const r of tracked) t[r.bill_id] = billOf(r)?.title ?? r.bill_id;
    return t;
  }, [tracked]);

  const quietCount = tracked.filter((r) => {
    const b = billOf(r);
    const d = daysSince(b?.latest_action_date);
    return d !== null && d >= QUIET_DAYS && !["enacted", "agreed", "vetoed", "failed"].includes(b?.status_stage ?? "");
  }).length;

  const filtered = tracked
    .filter((row) => {
      const b = billOf(row);
      if (!b) return false;
      if (stage !== "all" && b.status_stage !== stage) return false;
      if (position !== "all" && row.position !== position) return false;
      if (quietOnly) {
        const d = daysSince(b.latest_action_date);
        if (d === null || d < QUIET_DAYS || ["enacted", "agreed", "vetoed", "failed"].includes(b.status_stage)) return false;
      }
      const q = search.trim().toLowerCase();
      if (q && !`${b.title} ${citationFor(row.bill_id)} ${b.latest_action ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      const A = billOf(a), B = billOf(b);
      if (sortBy === "title") return (A?.title ?? "").localeCompare(B?.title ?? "");
      if (sortBy === "furthest") return (B?.progress_pct ?? 0) - (A?.progress_pct ?? 0);
      if (sortBy === "active") return String(B?.latest_action_date ?? "").localeCompare(String(A?.latest_action_date ?? ""));
      return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    });

  const filtersOn = stage !== "all" || position !== "all" || quietOnly || !!search.trim();
  const stagesPresent = new Set(tracked.map((r) => billOf(r)?.status_stage));
  const isEmpty = !loading && tracked.length === 0;

  return (
    <div className="page page-wide">
      <PageHeader
        title={isEmpty ? "Welcome to Bill Tracker" : `${greeting()}.`}
        description={
          isEmpty
            ? "Start by tracking a bill, or tell Discover which issues to watch."
            : loading
              ? "Loading your bills…"
              : `You're following ${tracked.length} bill${tracked.length === 1 ? "" : "s"}. Congress.gov is checked for changes every morning.`
        }
        actions={
          !isEmpty && (
            <>
              <Link href="/statistics" className="btn btn-ghost"><BarChart3 size={16} /> Statistics</Link>
              <button className="btn btn-secondary" onClick={() => downloadCsv(tracked, "my-bills.csv")} disabled={tracked.length === 0}><Download size={16} /> Export</button>
            </>
          )
        }
      />

      {!loading && tracked.length > 0 && (
        <CatchUp events={events} lastVisit={lastVisit} titles={titles} trackedCount={tracked.length} />
      )}

      <div className="dash-grid">
        <div className="dash-main">
          {isEmpty ? (
            <FirstRunHero onTracked={loadTracked} />
          ) : (
            <section aria-labelledby="mybills-title">
              {!loading && (
                <OnboardingChecklist hasTrackedBill={tracked.length > 0} hasEmailEnabled={!!profile?.email_notifications_enabled} hasTeam={!!profile?.organization_id} hasPhone={!!profile?.phone} />
              )}
              <div className="section-head">
                <h2 id="mybills-title" className="section-title">Your bills <span className="count">{filtered.length}{filtersOn ? ` of ${tracked.length}` : ""}</span></h2>
              </div>
              <div className="toolbar">
                <label className="search-field">
                  <Search size={15} aria-hidden="true" />
                  <input type="search" placeholder="Filter by title, number, or action" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter your bills" />
                </label>
                <select value={stage} onChange={(e) => setStage(e.target.value)} className="select" aria-label="Filter by stage">
                  <option value="all">Every stage</option>
                  {[...STAGE_ORDER, "agreed", "vetoed", "failed"].filter((s) => stagesPresent.has(s)).map((s) => (
                    <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                  ))}
                </select>
                <select value={position} onChange={(e) => setPosition(e.target.value)} className="select" aria-label="Filter by position">
                  <option value="all">Any position</option>
                  <option value="support">Support</option>
                  <option value="oppose">Oppose</option>
                  <option value="watching">Watching</option>
                  <option value="none">No position</option>
                </select>
                {quietCount > 0 && (
                  <button className={`chip${quietOnly ? " is-on" : ""}`} onClick={() => setQuietOnly((q) => !q)} aria-pressed={quietOnly} title={`No congressional action in ${QUIET_DAYS}+ days`}>
                    Gone quiet <span className="chip-count">{quietCount}</span>
                  </button>
                )}
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="select select-sort" aria-label="Sort">
                  {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              {error ? (
                <p className="error-text">Couldn't load your bills: {error}</p>
              ) : loading ? (
                <div className="list-skel">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel skel-billrow" />)}</div>
              ) : filtered.length === 0 ? (
                <div className="nomatch">
                  <p>No bills match those filters.</p>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setSearch(""); setStage("all"); setPosition("all"); setQuietOnly(false); }}>Clear filters</button>
                </div>
              ) : (
                <BillList rows={filtered} editable onUntrack={untrack} onBulkUntrack={bulkUntrack} animate={firstPaint} />
              )}
            </section>
          )}

          {recent.length > 0 && (
            <div className="recent">
              <span className="recent-label">Recently viewed</span>
              {recent.map((r) => (
                <Link key={r.billId} href={`/bill/${r.billId}`} className="recent-chip" title={r.title}>
                  <span className="cite">{citationFor(r.billId)}</span> {r.title}
                </Link>
              ))}
            </div>
          )}
        </div>

        <aside className="dash-aside">
          <DiscoverPanel onTracked={loadTracked} />
          <RegulationsTeaser />
        </aside>
      </div>
    </div>
  );
}

"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/SessionProvider";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/EmptyState";
import { citationFor, formatDate, explainAction, parseVoteInfo, EVENT_TYPE_LABELS } from "@/lib/billMeta";
import { fetchEvents, eventDate, type BillEventRow } from "@/lib/events";
import { Activity as ActivityIcon, TrendingUp, FileText, Users, ScrollText, Calculator, BookOpen, Search } from "lucide-react";

const ICONS: Record<string, any> = {
  status_change: TrendingUp, new_action: FileText, cosponsor_change: Users, text_published: ScrollText, cbo_published: Calculator, summary_published: BookOpen,
};

const FILTERS = [
  { id: "all", label: "Everything", types: null },
  { id: "moves", label: "Moved forward", types: ["status_change"] },
  { id: "actions", label: "Actions", types: ["new_action"] },
  { id: "docs", label: "Text, CBO & summaries", types: ["text_published", "cbo_published", "summary_published"] },
  { id: "people", label: "Cosponsors", types: ["cosponsor_change"] },
] as const;

function dayHeading(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

// Every recorded change to bills you or your team follow, grouped by the day
// it happened in Congress (not the day our check noticed it).
export default function ActivityPage() {
  const supabase = createClient();
  const router = useRouter();
  const { userId, profile, loading: sessionLoading } = useSession();
  const [rows, setRows] = useState<BillEventRow[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(150);

  useEffect(() => {
    if (sessionLoading) return;
    if (!userId) {
      router.push("/login");
      return;
    }
    (async () => {
      // RLS returns your own tracked bills plus your current team's.
      const { data: tracked } = await supabase.from("tracked_bills").select("bill_id, user_id");
      const all = Array.from(new Set((tracked ?? []).map((r) => r.bill_id)));
      setMine(new Set((tracked ?? []).filter((r) => r.user_id === userId).map((r) => r.bill_id)));
      if (all.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }
      const res = await fetchEvents(supabase, { billIds: all, limit, withTitles: true });
      setRows(res.rows);
      setError(res.error);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, userId, limit]);

  const visible = useMemo(() => {
    const types = FILTERS.find((f) => f.id === filter)?.types as readonly string[] | null;
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => !types || types.includes(r.event_type))
      .filter((r) => scope === "all" || mine.has(r.bill_id))
      .filter((r) => {
        if (!needle) return true;
        const b = Array.isArray(r.bills) ? r.bills[0] : r.bills;
        return `${b?.title ?? ""} ${citationFor(r.bill_id)} ${r.summary}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => eventDate(b).localeCompare(eventDate(a)) || b.occurred_at.localeCompare(a.occurred_at));
  }, [rows, filter, scope, mine, q]);

  const groups = useMemo(() => {
    const out: { day: string; items: BillEventRow[] }[] = [];
    for (const r of visible) {
      const day = eventDate(r).slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(r);
      else out.push({ day, items: [r] });
    }
    return out;
  }, [visible]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) c[f.id] = f.types ? rows.filter((r) => (f.types as readonly string[]).includes(r.event_type)).length : rows.length;
    return c;
  }, [rows]);

  return (
    <div className="page">
      <PageHeader
        title="Activity"
        description={`Every change to bills ${profile?.organization_id ? "you and your team follow" : "you follow"}, by the date it happened in Congress.`}
      />

      <div className="toolbar">
        <div className="chips" role="group" aria-label="Kind of change">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip${filter === f.id ? " is-on" : ""}`} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
              {f.label} {counts[f.id] > 0 && <span className="chip-count">{counts[f.id]}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          {profile?.organization_id && (
            <div className="seg" role="group" aria-label="Whose bills">
              <button className={scope === "all" ? "is-on" : ""} onClick={() => setScope("all")}>Team</button>
              <button className={scope === "mine" ? "is-on" : ""} onClick={() => setScope("mine")}>Mine</button>
            </div>
          )}
          <label className="search-field">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter activity" aria-label="Filter activity" />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="list-skel">{[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-billrow" />)}</div>
      ) : error ? (
        <p className="error-text">Couldn't load activity: {error}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No changes recorded yet">
          This fills in as our morning check of congress.gov picks up changes to the bills you track.
        </EmptyState>
      ) : visible.length === 0 ? (
        <div className="nomatch">
          <p>Nothing matches those filters.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => { setFilter("all"); setScope("all"); setQ(""); }}>Show everything</button>
        </div>
      ) : (
        <div className="feed">
          {groups.map((g) => (
            <section key={g.day} className="feed-day">
              <h2 className="feed-date">{dayHeading(g.day)}</h2>
              <ul className="feed-list">
                {g.items.map((r) => {
                  const bill = Array.isArray(r.bills) ? r.bills[0] : r.bills;
                  const Icon = ICONS[r.event_type] ?? FileText;
                  const vote = parseVoteInfo(r.summary);
                  const plain = r.event_type === "new_action" || r.event_type === "status_change" ? explainAction(r.event_type === "status_change" ? r.summary.replace(/^[^:]+:\s/, "") : r.summary, r.bill_id.split("-")[0]) : null;
                  return (
                    <li key={r.id} className={`feed-item ev-${r.event_type}`}>
                      <span className="feed-icon"><Icon size={15} /></span>
                      <div className="feed-body">
                        <div className="feed-meta">
                          <span className="cite">{citationFor(r.bill_id)}</span>
                          <span className="feed-type">{EVENT_TYPE_LABELS[r.event_type] ?? "Update"}</span>
                          {r.action_date && r.occurred_at.slice(0, 10) !== r.action_date && (
                            <span className="feed-seen">noticed {formatDate(r.occurred_at)}</span>
                          )}
                        </div>
                        {bill?.title && <Link href={`/bill/${r.bill_id}`} className="feed-bill">{bill.title}</Link>}
                        <p className="feed-summary">{r.summary}</p>
                        {vote && (
                          <span className="vote">
                            <span className="vote-bar" aria-hidden="true"><span style={{ width: `${(vote.yea / Math.max(1, vote.yea + vote.nay)) * 100}%` }} /></span>
                            <span className="vote-yea">{vote.yea} yea</span>
                            <span className="vote-nay">{vote.nay} nay</span>
                          </span>
                        )}
                        {plain && <p className="feed-plain">{plain}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {rows.length >= limit && (
            <button className="btn btn-secondary feed-more" onClick={() => setLimit((l) => l + 150)}>Load older activity</button>
          )}
        </div>
      )}
    </div>
  );
}

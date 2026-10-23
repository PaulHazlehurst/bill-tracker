"use client";

import Link from "next/link";
import { useMemo } from "react";
import { TrendingUp, FileText, Users, ScrollText, Calculator, BookOpen, ArrowRight } from "lucide-react";
import { citationFor, formatDate, EVENT_TYPE_LABELS } from "@/lib/billMeta";
import { eventDate, type BillEventRow } from "@/lib/events";

const ICONS: Record<string, any> = {
  status_change: TrendingUp,
  new_action: FileText,
  cosponsor_change: Users,
  text_published: ScrollText,
  cbo_published: Calculator,
  summary_published: BookOpen,
};

// What matters most comes first in the catch-up list.
const WEIGHT: Record<string, number> = { status_change: 5, cbo_published: 4, text_published: 3, summary_published: 3, new_action: 2, cosponsor_change: 1 };

function kindOf(type: string): "move" | "action" | "people" | "doc" {
  if (type === "status_change") return "move";
  if (type === "cosponsor_change") return "people";
  if (type === "new_action") return "action";
  return "doc";
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function relativeDay(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return formatDate(iso) ?? "";
}

// The dashboard's opening moment: what changed on your bills since you were
// last here, with a two-week movement strip so the rhythm is visible at a
// glance. Everything shown is a real recorded change.
export default function CatchUp({
  events,
  lastVisit,
  titles,
  trackedCount,
}: {
  events: BillEventRow[];
  lastVisit: string | null;
  titles: Record<string, string>;
  trackedCount: number;
}) {
  const { days, fresh, movedBills, windowLabel } = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today.getTime() - (13 - i) * 86_400_000);
      return { key: dayKey(d), date: d, move: 0, action: 0, people: 0, doc: 0 };
    });
    const byKey = new Map(days.map((d) => [d.key, d]));
    for (const e of events) {
      const slot = byKey.get(eventDate(e).slice(0, 10));
      if (slot) slot[kindOf(e.event_type)]++;
    }

    // "Since last visit" uses detection time: that's when it became news to you.
    const since = lastVisit ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
    const fresh = events
      .filter((e) => e.occurred_at > since)
      .sort((a, b) => (WEIGHT[b.event_type] ?? 0) - (WEIGHT[a.event_type] ?? 0) || eventDate(b).localeCompare(eventDate(a)));
    const movedBills = new Set(fresh.map((e) => e.bill_id)).size;
    const windowLabel = lastVisit ? `since you were last here ${relativeDay(lastVisit)}` : "in the past week";
    return { days, fresh, movedBills, windowLabel };
  }, [events, lastVisit]);

  const max = Math.max(1, ...days.map((d) => d.move + d.action + d.people + d.doc));
  // One row per bill in the list: its most important change.
  const top: BillEventRow[] = [];
  const seen = new Set<string>();
  for (const e of fresh) {
    if (seen.has(e.bill_id)) continue;
    seen.add(e.bill_id);
    top.push(e);
    if (top.length >= 4) break;
  }

  return (
    <section className="catchup" aria-labelledby="catchup-title">
      <div className="catchup-head">
        <h2 id="catchup-title" className="catchup-title">
          {movedBills > 0 ? (
            <>
              <span className="catchup-num">{movedBills}</span> of your {trackedCount} bill{trackedCount === 1 ? "" : "s"} changed {windowLabel}
            </>
          ) : (
            <>Nothing new on your bills {windowLabel}</>
          )}
        </h2>
        <Link href="/activity" className="btn btn-ghost btn-sm">All activity <ArrowRight size={14} /></Link>
      </div>

      <div className="catchup-body">
      <div className="catchup-chart">
      <div className="strip" role="img" aria-label={`Changes per day over the last 14 days: ${days.map((d) => d.move + d.action + d.people + d.doc).join(", ")}`}>
        {days.map((d, i) => {
          const total = d.move + d.action + d.people + d.doc;
          const isToday = i === days.length - 1;
          return (
            <div key={d.key} className={`strip-day${isToday ? " is-today" : ""}`} title={`${d.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${total} change${total === 1 ? "" : "s"}`}>
              <div className="strip-bar" style={{ height: `${Math.max(total ? 14 : 4, (total / max) * 100)}%` }}>
                {total > 0 && (["move", "doc", "action", "people"] as const).map((k) => d[k] > 0 && <span key={k} className={`strip-seg seg-${k}`} style={{ flexGrow: d[k] }} />)}
              </div>
              <span className="strip-label">{isToday ? "Today" : d.date.getDay() === 1 || i === 0 ? d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</span>
            </div>
          );
        })}
      </div>
      <div className="strip-legend" aria-hidden="true">
        <span><i className="seg-move" /> Moved forward</span>
        <span><i className="seg-doc" /> Text, CBO, summaries</span>
        <span><i className="seg-action" /> Other actions</span>
        <span><i className="seg-people" /> Cosponsors</span>
      </div>
      </div>

      {top.length > 0 && (
        <ul className="catchup-list">
          {top.map((e) => {
            const Icon = ICONS[e.event_type] ?? FileText;
            return (
              <li key={e.id} className={`catchup-item kind-${kindOf(e.event_type)}`}>
                <span className="catchup-icon"><Icon size={15} /></span>
                <div className="catchup-text">
                  <div className="catchup-line">
                    <span className="cite">{citationFor(e.bill_id)}</span>
                    <span className="catchup-type">{EVENT_TYPE_LABELS[e.event_type] ?? "Update"}</span>
                    <time className="catchup-date">{formatDate(eventDate(e))}</time>
                  </div>
                  <Link href={`/bill/${e.bill_id}`} className="catchup-bill">{titles[e.bill_id] ?? citationFor(e.bill_id)}</Link>
                  <p className="catchup-summary">{e.summary}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {top.length === 0 && <p className="catchup-quiet">When congress.gov records a change to any bill you follow, it shows up here the next morning.</p>}
      </div>
    </section>
  );
}

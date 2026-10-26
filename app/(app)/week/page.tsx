"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import RouteLine from "@/components/ui/RouteLine";
import { useUI } from "@/components/UIProvider";
import { citationFor, formatDate, timeAgo } from "@/lib/billMeta";
import { FLOOR_CATEGORY_LABELS, addDays } from "@/lib/houseFloor";
import { reasonsFor, type WeekView, type WeekEvent, type FloorView } from "@/lib/weekAhead";
import type { Deadline } from "@/lib/weekData";
import { CalendarPlus, ChevronLeft, ChevronRight, Mail, RefreshCw, Video, FileText, ExternalLink, X, Copy, Check, CalendarDays } from "lucide-react";

type WeekResponse = {
  start: string;
  thisWeek: string;
  scope: "mine" | "all";
  view: WeekView;
  headline: string;
  deadlines: Deadline[];
  bills: Record<string, { title: string; stage: string; type: string }>;
  hasTopics: boolean;
  trackedCount: number;
  floorSource: string | null;
  floorFetchedAt: string | null;
  lastSync: string | null;
  stale: boolean;
  ready: boolean;
};

function rangeLabel(start: string) {
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${addDays(start, 6)}T12:00:00Z`);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const f = (d: Date, withMonth: boolean) => d.toLocaleDateString("en-US", { month: withMonth ? "short" : undefined, day: "numeric", timeZone: "UTC" });
  return `${f(a, true)} to ${f(b, !sameMonth)}`;
}

function daysUntil(day: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return Math.round((new Date(`${day}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
}

export default function WeekAheadPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useUI();
  const start = params.get("start") ?? "";
  const scope = params.get("scope") === "all" ? "all" : "mine";

  const [data, setData] = useState<WeekResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const refreshedFor = useRef(new Set<string>());

  async function load(quiet = false) {
    if (!quiet) setData(null);
    setError(null);
    const qs = new URLSearchParams();
    if (start) qs.set("start", start);
    if (scope === "all") qs.set("scope", "all");
    const res = await fetch(`/api/week?${qs}`).catch(() => null);
    if (!res || !res.ok) {
      setError("Couldn't load the schedule. Try again in a moment.");
      return null;
    }
    const body: WeekResponse = await res.json();
    setData(body);
    return body;
  }

  async function refresh(manual = false) {
    setRefreshing(true);
    const res = await fetch("/api/week/refresh", { method: "POST" }).catch(() => null);
    setRefreshing(false);
    if (!res || !res.ok) {
      if (manual) toast("Couldn't reach congress.gov just now. Showing the last saved schedule.", "error");
      return;
    }
    await load(true);
    if (manual) toast("Schedule is up to date", "success");
  }

  useEffect(() => {
    load().then((body) => {
      // The morning job keeps this fresh; if it's behind, catch up once.
      if (body?.ready && body.stale && !refreshedFor.current.has(body.start)) {
        refreshedFor.current.add(body.start);
        refresh();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, scope]);

  function go(next: { start?: string; scope?: string }) {
    const qs = new URLSearchParams();
    const s = next.start ?? data?.start ?? start;
    const sc = next.scope ?? scope;
    if (s && s !== data?.thisWeek) qs.set("start", s);
    if (sc === "all") qs.set("scope", "all");
    router.push(`/week${qs.toString() ? `?${qs}` : ""}`);
  }

  async function emailTeam() {
    if (!data) return;
    setEmailing(true);
    const res = await fetch("/api/week/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: data.start }) }).catch(() => null);
    setEmailing(false);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) return toast(body.error ?? "The email didn't send.", "error");
    toast(
      `Sent to ${body.sent} ${body.sent === 1 ? "person" : "people"}${body.skipped ? `. ${body.skipped} teammate${body.skipped === 1 ? " has" : "s have"} email turned off in Settings` : ""}`,
      "success",
    );
  }

  const weekStart = data?.start ?? start;
  const isThisWeek = !!data && data.start === data.thisWeek;

  return (
    <div className="page page-wide week">
      <PageHeader
        title="Week ahead"
        description={data ? data.headline : "Committee hearings, markups and floor votes that touch your bills and topics."}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setCalendarOpen(true)}><CalendarPlus size={15} /> Add to my calendar</button>
            <button className="btn btn-secondary" onClick={emailTeam} disabled={!data || emailing}><Mail size={15} /> {emailing ? "Sending…" : "Email the team"}</button>
          </>
        }
      />

      <div className="wk-toolbar">
        <div className="wk-nav" role="group" aria-label="Choose a week">
          <button className="icon-btn" onClick={() => weekStart && go({ start: addDays(weekStart, -7) })} aria-label="Previous week" disabled={!weekStart}><ChevronLeft size={18} /></button>
          <span className="wk-range">{weekStart ? rangeLabel(weekStart) : "This week"}</span>
          <button className="icon-btn" onClick={() => weekStart && go({ start: addDays(weekStart, 7) })} aria-label="Next week" disabled={!weekStart}><ChevronRight size={18} /></button>
          {data && !isThisWeek && <button className="link-btn" onClick={() => go({ start: data.thisWeek })}>Back to this week</button>}
        </div>
        <div className="seg" role="group" aria-label="What to show">
          <button aria-pressed={scope === "mine"} onClick={() => go({ scope: "mine" })}>Your bills and topics</button>
          <button aria-pressed={scope === "all"} onClick={() => go({ scope: "all" })}>Everything</button>
        </div>
        <span className="wk-sync">
          {refreshing ? (
            <><span className="spinner" aria-hidden="true" /> Getting the latest from congress.gov…</>
          ) : data?.lastSync ? (
            <>Updated {timeAgo(data.lastSync)} <button className="link-btn" onClick={() => refresh(true)}><RefreshCw size={13} /> Update now</button></>
          ) : null}
        </span>
      </div>

      {error && <p className="error-text">{error}</p>}

      {!data && !error && (
        <div className="wk-days">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="skel skel-block" style={{ height: 220 }} />)}
        </div>
      )}

      {data && !data.ready && (
        <div className="empty">
          <div className="empty-icon"><CalendarDays size={20} /></div>
          <p className="empty-title">Week ahead needs a one-time database update</p>
          <p className="empty-body">Run <code>supabase/migrations/0002_week_ahead.sql</code> in Supabase, SQL Editor. The Data sources page lists every update that's still waiting.</p>
          <div className="empty-action"><Link className="btn btn-secondary" href="/api-usage">Open Data sources</Link></div>
        </div>
      )}

      {data && data.ready && (
        <>
          <div className="wk-top">
            {(data.view.floor.length > 0 || (isThisWeek && data.floorFetchedAt)) && <FloorBand items={data.view.floor} bills={data.bills} scope={scope} source={data.floorSource} />}
            <section className="card wk-deadlines-card">
              <h2 className="card-title">Comment deadlines</h2>
              <p className="card-sub">Rules on your topics with comment periods closing soon.</p>
              {data.deadlines.length === 0 ? (
                <p className="muted">No open comment periods on rules matching your topics.</p>
              ) : (
                <ul className="wk-deadlines">
                  {data.deadlines.slice(0, 4).map((d) => {
                    const left = daysUntil(d.closes);
                    return (
                      <li key={d.id} className={left <= 7 ? "is-soon" : ""}>
                        <a href={d.url ?? "/regulations"} target={d.url ? "_blank" : undefined} rel="noreferrer">
                          <span className="wk-dl-top">
                            <span className="wk-dl-title">{d.title}</span>
                            <span className="wk-dl-left">{left <= 0 ? "Today" : left === 1 ? "1 day" : `${left} days`}</span>
                          </span>
                          <span className="wk-dl-meta">{[d.agency, `closes ${formatDate(d.closes)}`].filter(Boolean).join(". ")}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <section className="wk-days" aria-label="Committee meetings by day">
            {data.view.days.map((d) => {
              const today = d.day === new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
              const hasMarkup = d.events.some((e) => e.kind === "Markup" && e.relevance.length && e.status === "Scheduled");
              return (
                <div key={d.day} className={`wk-day${today ? " is-today" : ""}${hasMarkup ? " has-markup" : ""}`}>
                  <h2 className="wk-day-head">
                    <span className="wk-day-num">{d.dayOfMonth}</span>
                    <span className="wk-day-name">{d.weekday}{today && <span className="wk-today">Today</span>}</span>
                    <span className="wk-day-count">{d.events.length ? `${d.events.length} meeting${d.events.length === 1 ? "" : "s"}` : ""}</span>
                  </h2>
                  {d.events.length === 0 ? (
                    <p className="wk-none">{scope === "mine" ? "Nothing on your bills or topics." : "No committee meetings posted."}</p>
                  ) : (
                    d.events.map((e) => <EventCard key={e.id} e={e} bills={data.bills} muted={scope === "all" && e.relevance.length === 0} />)
                  )}
                </div>
              );
            })}
          </section>

          {scope === "mine" && data.trackedCount === 0 && !data.hasTopics && (
            <section className="card wk-nudge">
              <h2 className="card-title">Make this week yours</h2>
              <p className="card-sub">Track a few bills or add topics on your dashboard, and their hearings and markups show up here.</p>
              <Link className="btn btn-secondary btn-sm" href="/dashboard">Go to My bills</Link>
            </section>
          )}

          <p className="wk-source">
            Committee schedules come from congress.gov and the House floor schedule from the Majority Leader&apos;s weekly list. Times are Eastern. The Senate doesn&apos;t publish a floor schedule in advance.
          </p>
        </>
      )}

      {calendarOpen && <CalendarDialog onClose={() => setCalendarOpen(false)} />}
    </div>
  );
}

function EventCard({ e, bills, muted }: { e: WeekEvent; bills: WeekResponse["bills"]; muted: boolean }) {
  const cancelled = e.status !== "Scheduled";
  const reasons = reasonsFor(e);
  return (
    <article className={`wk-event kind-${e.kind.toLowerCase()}${cancelled ? " is-cancelled" : ""}${muted ? " is-muted" : ""}`}>
      <div className="wk-event-top">
        <span className="wk-time">{e.time ?? "Time to be announced"}</span>
        <span className={`wk-kind wk-kind-${e.kind.toLowerCase()}`}>{e.kind}</span>
      </div>
      {cancelled && <span className="wk-status">{e.status}</span>}
      <h3 className="wk-title">{e.title}</h3>
      <p className="wk-committee">{e.committees.join("; ") || `${e.chamber} committee`}</p>
      {e.bills.length > 0 && (
        <ul className="wk-bills">
          {e.bills.slice(0, 4).map((b) => {
            const info = bills[b.billId];
            return (
              <li key={b.billId}>
                <Link href={`/bill/${b.billId}`} className={`wk-bill${b.tracked ? " is-tracked" : ""}`}>
                  <span className="wk-bill-top">
                    <span className="cite">{b.citation}</span>
                    {b.tracked ? <span className="wk-flag">Tracking</span> : b.suggested ? <span className="wk-flag is-sugg">Suggested</span> : null}
                  </span>
                  {info && <span className="wk-bill-title">{info.title}</span>}
                  {info && <RouteLine stage={info.stage} billType={info.type} />}
                </Link>
              </li>
            );
          })}
          {e.bills.length > 4 && <li className="wk-more">and {e.bills.length - 4} more</li>}
        </ul>
      )}
      {reasons.length > 0 && <p className="wk-why">{reasons.slice(0, 2).join(". ")}</p>}
      {e.kind === "Markup" && !cancelled && e.relevance.some((r) => r.kind !== "topic") && <p className="wk-markup-note">A markup is a committee vote on whether to send the bill to the full chamber.</p>}
      <div className="wk-links">
        {e.witnessCount > 0 && <span className="wk-fact"><FileText size={13} aria-hidden="true" /> {e.witnessCount} witness{e.witnessCount === 1 ? "" : "es"} listed</span>}
        {e.videoUrl && <a href={e.videoUrl} target="_blank" rel="noreferrer"><Video size={13} aria-hidden="true" /> Video</a>}
        {e.url && <a href={e.url} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" /> Details</a>}
      </div>
    </article>
  );
}

function FloorBand({ items, bills, scope, source }: { items: FloorView[]; bills: WeekResponse["bills"]; scope: "mine" | "all"; source: string | null }) {
  return (
    <section className="wk-floor" aria-labelledby="floor-title">
      <div className="wk-floor-head">
        <h2 id="floor-title" className="wk-floor-title">On the House floor this week</h2>
        <p className="wk-floor-desc">
          Bills the Majority Leader scheduled for possible votes. The day isn&apos;t announced in advance.
          {source && <> <a href={source} target="_blank" rel="noreferrer">Source</a></>}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="wk-none">{scope === "mine" ? "None of your bills are on this week's list." : "The House hasn't posted this week's list yet."}</p>
      ) : (
        <ul className="wk-floor-list">
          {items.map((f) => {
            const info = f.billId ? bills[f.billId] : undefined;
            const title = info?.title ?? (f.title || citationFor(f.billId ?? ""));
            const inner = (
              <>
                <span className="wk-floor-top">
                  <span className="cite">{f.citation}</span>
                  {f.tracked ? <span className="wk-flag">Tracking</span> : f.suggested ? <span className="wk-flag is-sugg">Suggested</span> : null}
                </span>
                <span className="wk-floor-name">{title}</span>
                <span className={`wk-floor-how how-${f.category}`}>{FLOOR_CATEGORY_LABELS[f.category]}</span>
                {f.clients.length > 0 && <span className="wk-floor-clients">Followed by {f.clients.join(", ")}</span>}
              </>
            );
            return <li key={f.citation}>{f.billId ? <Link href={`/bill/${f.billId}`} className="wk-floor-item">{inner}</Link> : <div className="wk-floor-item">{inner}</div>}</li>;
          })}
        </ul>
      )}
    </section>
  );
}

function CalendarDialog({ onClose }: { onClose: () => void }) {
  const { toast, confirm } = useUI();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/calendar/link")
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error);
        setUrl(b.url);
      })
      .catch((e) => setError(e?.message || "Couldn't create your calendar link."));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function reset() {
    if (!(await confirm("Make a new link? Calendars using the old one will stop updating until you add the new one.", { confirmLabel: "Make a new link" }))) return;
    const r = await fetch("/api/calendar/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      setUrl(b.url);
      toast("New calendar link ready. The old one no longer works.", "success");
    } else toast("Couldn't reset the link.", "error");
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog dialog-sm" role="dialog" aria-modal="true" aria-labelledby="cal-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="cal-title" className="dialog-title">Add your week to a calendar</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="cal-body">
          <p>Hearings and markups on your bills and topics, plus comment deadlines, kept up to date automatically.</p>
          {error ? (
            <p className="error-text">{error}</p>
          ) : (
            <div className="cal-link">
              <input className="input" readOnly value={url ?? "Creating your link…"} aria-label="Your calendar link" onFocus={(e) => e.currentTarget.select()} />
              <button
                className="btn btn-primary"
                disabled={!url}
                onClick={() => url && navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          <ul className="cal-steps">
            <li><strong>Google Calendar:</strong> next to Other calendars, choose the plus sign, then From URL, and paste.</li>
            <li><strong>Outlook:</strong> Add calendar, then Subscribe from web, and paste.</li>
            <li><strong>Apple Calendar:</strong> File, then New Calendar Subscription, and paste.</li>
          </ul>
          <p className="muted">Calendar apps check for changes every few hours. Anyone with this link can see the meeting list, but nothing else from your account.</p>
          <button className="link-btn" onClick={reset} disabled={!url}>Make a new link</button>
        </div>
      </div>
    </div>
  );
}

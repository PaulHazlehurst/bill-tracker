"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useUI } from "@/components/UIProvider";
import { extractMeta, formatDate, timeAgo, parseVoteInfo, citationFor, publicBillUrl, explainAction, daysSince, EVENT_TYPE_LABELS } from "@/lib/billMeta";
import { journeyFromActions, STAGE_LABELS } from "@/lib/billStage";
import { recordView } from "@/lib/recentlyViewed";
import { hasSeenEnactedCelebration, markEnactedCelebrationSeen } from "@/lib/celebrationTracker";
import { fetchEvents, eventDate, type BillEventRow } from "@/lib/events";
import { useTicker } from "@/lib/useTicker";
import RouteLine, { StagePill } from "@/components/ui/RouteLine";
import Confetti from "@/components/Confetti";
import PartyBreakdownChart from "@/components/PartyBreakdownChart";
import ExpandableText from "@/components/ExpandableText";
import MemberPositions from "@/components/MemberPositions";
import MomentumSignals from "@/components/MomentumSignals";
import BillWorkspace from "@/components/BillWorkspace";
import BillNewsSection from "@/components/BillNewsSection";
import BillLobbyingSection from "@/components/BillLobbyingSection";
import BillRecordSection from "@/components/BillRecordSection";
import TextChanges from "@/components/TextChanges";
import BillClients from "@/components/BillClients";
import {
  ArrowLeft, ExternalLink, Printer, Share2, Check, Plus, RefreshCw, Mail, MessageSquare, ChevronDown, HelpCircle, Landmark,
} from "lucide-react";

type Bill = {
  id: string;
  congress: number;
  bill_type: string;
  bill_number: number;
  title: string;
  status_stage: string;
  progress_pct: number;
  latest_action: string | null;
  latest_action_date: string | null;
  congress_url: string | null;
  raw_snapshot: any | null;
  last_polled_at: string | null;
};
type RelatedBill = { congress: number; type: string; number: string; title: string; latestActionText: string | null; relationshipType: string | null };
type BillActionItem = { actionDate: string; text: string; type: string | null; actionCode?: string | null; chamber?: string | null; hasRecordedVote: boolean };
type CommitteeActivityItem = { committeeName: string; chamber: string; activities: { date: string; name: string }[] };
type HearingDetailItem = {
  date: string; committeeName: string; title: string | null; meetingType: string | null; location: string | null;
  witnesses: { name: string; position: string | null; organization: string | null; statementUrl: string | null }[];
  videoUrl: string | null; documents: { name: string; description: string | null; type: string | null; url: string | null }[];
};
type BillSummaryItem = { text: string; actionDesc: string; actionDate: string; updateDate: string };
type RecordMentionItem = { title: string; date: string | null; section: string | null; url: string | null; snippet?: string | null };
type TextVersionItem = { type: string; date: string | null; formats: { type: string; url: string }[] };
type NewsItemType = { title: string; source: string; url: string; publisherUrl?: string | null; publishedAt: string | null; snippet?: string | null; tier?: "wire" | "mainstream" | "trade" | "local" | "other" };
type LobbyingFilingItem = { filingUuid: string; filingYear: number; filingType: string; registrantName: string; clientName: string; issueDescription: string; documentUrl: string };

type TabId = "overview" | "history" | "text" | "people" | "coverage" | "workspace";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "Full history" },
  { id: "text", label: "Text & changes" },
  { id: "people", label: "People & money" },
  { id: "coverage", label: "Hearings & news" },
  { id: "workspace", label: "Team notes" },
];

function VoteBadge({ text }: { text: string | null | undefined }) {
  const vote = parseVoteInfo(text);
  if (!vote) return null;
  const total = vote.yea + vote.nay;
  return (
    <span className="vote" title={vote.rollNumber ? `Roll call ${vote.rollNumber}` : undefined}>
      <span className="vote-bar" aria-hidden="true"><span style={{ width: `${total ? (vote.yea / total) * 100 : 50}%` }} /></span>
      <span className="vote-yea">{vote.yea} yea</span>
      <span className="vote-nay">{vote.nay} nay</span>
      {vote.rollNumber && <span className="vote-roll">Roll call {vote.rollNumber}</span>}
    </span>
  );
}

function Explainer({ text, billType }: { text: string | null | undefined; billType?: string }) {
  const plain = explainAction(text, billType);
  if (!plain) return null;
  return (
    <p className="explain">
      <HelpCircle size={14} aria-hidden="true" />
      <span><strong>What this means:</strong> {plain}</span>
    </p>
  );
}

export default function BillDetailPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useParams();
  const { toast, confirm } = useUI();
  const billId = params.id as string;
  useTicker();

  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<BillEventRow[]>([]);
  const [related, setRelated] = useState<RelatedBill[] | null>(null);
  const [breakdown, setBreakdown] = useState<{ D: number; R: number; I: number; capped: boolean } | null>(null);
  const [actions, setActions] = useState<BillActionItem[] | null>(null);
  const [committees, setCommittees] = useState<CommitteeActivityItem[] | null>(null);
  const [hearings, setHearings] = useState<HearingDetailItem[] | null>(null);
  const [summaries, setSummaries] = useState<BillSummaryItem[] | null>(null);
  const [lobbying, setLobbying] = useState<LobbyingFilingItem[]>([]);
  const [record, setRecord] = useState<RecordMentionItem[]>([]);
  const [texts, setTexts] = useState<TextVersionItem[] | null>(null);
  const [news, setNews] = useState<NewsItemType[] | null>(null);
  const [trackedRowId, setTrackedRowId] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");
  const [trackMenu, setTrackMenu] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "major">("all");
  const triedEnsure = useRef(false);

  async function load(opts: { quiet?: boolean } = {}) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const [{ data: billData, error: billError }, { data: trackedData }] = await Promise.all([
      supabase
        .from("bills")
        .select("id, congress, bill_type, bill_number, title, status_stage, progress_pct, latest_action, latest_action_date, congress_url, raw_snapshot, last_polled_at")
        .eq("id", billId)
        .maybeSingle(),
      supabase.from("tracked_bills").select("id, notify_email, notify_sms").eq("bill_id", billId).eq("user_id", user.id).maybeSingle(),
    ]);

    if (!billData) {
      // Not cached yet (opened from search or a suggestion): fetch it from
      // congress.gov once, then load again.
      if (!triedEnsure.current) {
        triedEnsure.current = true;
        const res = await fetch("/api/bills/ensure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ billId }) }).catch(() => null);
        if (res?.ok) return load(opts);
        const body = res ? await res.json().catch(() => ({})) : {};
        setError(body.error ?? "We couldn't find that bill.");
      } else {
        setError(billError?.message ?? "We couldn't find that bill.");
      }
      setLoading(false);
      return;
    }

    setBill(billData as Bill);
    recordView(billId, billData.title);
    if (billData.status_stage === "enacted" && !hasSeenEnactedCelebration(billId)) {
      setCelebrate(true);
      markEnactedCelebrationSeen(billId);
    }
    if (trackedData) {
      setTrackedRowId(trackedData.id);
      setNotifyEmail(trackedData.notify_email);
      setNotifySms(trackedData.notify_sms);
    } else setTrackedRowId(null);
    setLoading(false);

    const { rows } = await fetchEvents(supabase, { billIds: [billId], limit: 60 });
    setEvents(rows);
    if (opts.quiet) return;

    const q = `billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`;
    const get = (path: string) => fetch(`/api/bills/${path}?${q}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    get("actions").then((b: any) => setActions(b.actions ?? []));
    get("related").then((b: any) => setRelated(b.related ?? []));
    get("cosponsor-breakdown").then((b: any) => setBreakdown(b.breakdown ?? null));
    get("committee-activity").then((b: any) => setCommittees(b.committees ?? []));
    get("hearing-details").then((b: any) => setHearings(b.hearings ?? []));
    get("summaries").then((b: any) => setSummaries(b.summaries ?? []));
    get("lobbying-activity").then((b: any) => setLobbying(b.filings ?? []));
    get("congressional-record").then((b: any) => setRecord(b.mentions ?? []));
    get("text-versions").then((b: any) => setTexts(b.versions ?? []));
    fetch(`/api/bills/news?billId=${billId}&title=${encodeURIComponent(billData.title)}&citation=${encodeURIComponent(citationFor(billId))}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((b) => setNews(b.items ?? []))
      .catch(() => setNews([]));
  }

  useEffect(() => {
    triedEnsure.current = false;
    setLoading(true);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId]);

  // Close the tracking menu on outside click.
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!trackMenu) return;
    const close = (e: MouseEvent) => trackRef.current && !trackRef.current.contains(e.target as Node) && setTrackMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [trackMenu]);

  // Milestone dates for each station on the route line, from the real history.
  const journey = useMemo(() => (bill && actions && actions.length ? journeyFromActions(actions, bill.bill_type) : null), [bill, actions]);
  const stationDates = useMemo(() => {
    if (!journey || !bill) return undefined;
    const first = journey.originChamber === "House" ? journey.passedHouse : journey.passedSenate;
    const second = journey.originChamber === "House" ? journey.passedSenate : journey.passedHouse;
    const type = bill.bill_type;
    if (type === "hres" || type === "sres") return [journey.introduced?.date, journey.committee?.date, first?.date, first?.date];
    if (type === "hconres" || type === "sconres") return [journey.introduced?.date, journey.committee?.date, first?.date, second?.date, second?.date];
    return [journey.introduced?.date, journey.committee?.date, first?.date, second?.date, journey.toPresident?.date, journey.law?.date];
  }, [journey, bill]);

  async function handleTrack() {
    if (!bill) return;
    setBusy(true);
    const res = await fetch("/api/bills/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ congress: bill.congress, billType: bill.bill_type, billNumber: bill.bill_number }),
    });
    setBusy(false);
    if (res.ok) {
      toast(`Tracking ${citationFor(billId)}`, "success");
      load({ quiet: true });
    } else {
      const body = await res.json().catch(() => ({}));
      toast(body.error ?? "Couldn't track that bill.", "error");
    }
  }

  async function handleUntrack() {
    if (!trackedRowId || !bill) return;
    setTrackMenu(false);
    if (!(await confirm(`Stop tracking ${citationFor(billId)}?`, { confirmLabel: "Stop tracking", danger: true }))) return;
    setBusy(true);
    const res = await fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(trackedRowId)}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setTrackedRowId(null);
      toast("Stopped tracking", "info");
    } else toast("Couldn't stop tracking. Try again.", "error");
  }

  async function toggleNotify(field: "email" | "sms", value: boolean) {
    const nextEmail = field === "email" ? value : notifyEmail;
    const nextSms = field === "sms" ? value : notifySms;
    setNotifyEmail(nextEmail);
    setNotifySms(nextSms);
    const res = await fetch("/api/bills/toggle-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billId, notifyEmail: nextEmail, notifySms: nextSms }),
    });
    if (!res.ok) toast("Couldn't update alerts.", "error");
  }

  async function checkNow() {
    setChecking(true);
    try {
      const res = await fetch("/api/bills/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ billId }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) toast(body.error ?? "Couldn't reach congress.gov.", "error");
      else if (body.skipped) toast(`Already checked ${timeAgo(body.lastPolledAt)}. Nothing newer yet.`, "info");
      else {
        toast(body.events > 0 ? `Found ${body.events} new change${body.events === 1 ? "" : "s"}` : "Up to date. No changes since the last check.", body.events > 0 ? "success" : "info");
        load();
      }
    } finally {
      setChecking(false);
    }
  }

  function copyShare() {
    navigator.clipboard.writeText(`${window.location.origin}/share/bill/${billId}`).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="page">
        <div className="skel skel-line" style={{ width: 140 }} />
        <div className="skel skel-title" style={{ height: 76 }} />
        <div className="skel skel-block" />
        <div className="skel skel-block" />
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="page">
        <Link href="/dashboard" className="backlink"><ArrowLeft size={15} /> My bills</Link>
        <div className="empty">
          <div className="empty-icon"><Landmark size={20} /></div>
          <p className="empty-title">We couldn't open {citationFor(billId)}</p>
          <p className="empty-body">{error} Check the bill number, or search for it instead.</p>
          <div className="empty-action"><button className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent("bt:find-bill"))}>Search for a bill</button></div>
        </div>
      </div>
    );
  }

  const meta = extractMeta(bill.raw_snapshot);
  const allActions = actions ?? [];
  const votes = allActions.filter((a) => a.hasRecordedVote || parseVoteInfo(a.text));
  const hasCbo = !!meta?.cboCostEstimates?.length;
  const quiet = daysSince(bill.latest_action_date);
  const hearingRows = (committees ?? []).flatMap((c) => c.activities.filter((a) => a.name === "Hearings by").map((a) => ({ c, a })));
  const MAJOR = /passed|agreed to|reported|ordered to be reported|presented|signed|became|vetoed|cloture|introduced|placed on|hearings?|mark-?up|failed/i;
  const historyRows = historyFilter === "major" ? allActions.filter((a) => MAJOR.test(a.text)) : allActions;

  return (
    <div className="page bill-page">
      <style>{`@media print { [data-billpanel] { display: block !important; } }`}</style>
      <Link href="/dashboard" className="backlink no-print"><ArrowLeft size={15} /> My bills</Link>

      {celebrate && (
        <>
          <Confetti />
          <div className="banner banner-law no-print" role="status"><strong>This bill is now law.</strong> You followed it all the way through.</div>
        </>
      )}

      <header className="bill-hero">
        <div className="bill-hero-meta">
          <span className="cite cite-lg">{citationFor(billId)}</span>
          <StagePill stage={bill.status_stage} />
          {meta?.chamber && <span className="meta-item">Started in the {meta.chamber}</span>}
          {meta?.introducedDate && <span className="meta-item">Introduced {meta.introducedDate}</span>}
          {meta?.policyArea && <span className="meta-item">{meta.policyArea}</span>}
        </div>
        <h1 className="bill-title">{bill.title}</h1>
        {meta?.sponsorName && (
          <p className="bill-sponsor">
            Sponsored by <strong>{meta.sponsorName}</strong>
            {typeof meta.cosponsorCount === "number" && meta.cosponsorCount > 0 && <> with {meta.cosponsorCount} cosponsor{meta.cosponsorCount === 1 ? "" : "s"}</>}
          </p>
        )}

        <div className="bill-actions no-print">
          {trackedRowId ? (
            <div className="split" ref={trackRef}>
              <button className="btn btn-tracking" onClick={() => setTrackMenu((o) => !o)} aria-expanded={trackMenu}>
                <Check size={16} strokeWidth={2.5} /> Tracking <ChevronDown size={15} />
              </button>
              {trackMenu && (
                <div className="menu" role="menu">
                  <label className="menu-item menu-toggle"><Mail size={15} /> Email alerts <input type="checkbox" className="switch" checked={notifyEmail} onChange={(e) => toggleNotify("email", e.target.checked)} /></label>
                  <label className="menu-item menu-toggle"><MessageSquare size={15} /> Text alerts <input type="checkbox" className="switch" checked={notifySms} onChange={(e) => toggleNotify("sms", e.target.checked)} /></label>
                  <div className="menu-sep" />
                  <button className="menu-item menu-danger" onClick={handleUntrack} disabled={busy}>Stop tracking</button>
                </div>
              )}
            </div>
          ) : (
            <button className="btn btn-primary" onClick={handleTrack} disabled={busy}><Plus size={16} strokeWidth={2.4} /> {busy ? "Tracking…" : "Track this bill"}</button>
          )}
          <button className="btn btn-secondary" onClick={checkNow} disabled={checking} title="Re-check congress.gov for this bill now">
            <RefreshCw size={15} className={checking ? "spin" : ""} /> {checking ? "Checking…" : "Check now"}
          </button>
          <button className="btn btn-ghost" onClick={copyShare}><Share2 size={15} /> {shareCopied ? "Link copied" : "Share"}</button>
          <button className="btn btn-ghost" onClick={() => window.print()}><Printer size={15} /> Print brief</button>
          <a className="btn btn-ghost" href={publicBillUrl(billId)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> congress.gov</a>
        </div>
      </header>

      <section className="journey" aria-label="Where this bill is in the process">
        <RouteLine stage={bill.status_stage} billType={bill.bill_type} size="lg" dates={stationDates} animate />
        <div className="journey-foot">
          <span>{STAGE_LABELS[bill.status_stage] ?? bill.status_stage}{quiet !== null && quiet >= 90 && !["enacted", "agreed", "vetoed", "failed"].includes(bill.status_stage) ? `, with no action for ${quiet} days` : ""}</span>
          {bill.last_polled_at && <span className="muted">Checked {timeAgo(bill.last_polled_at)}</span>}
        </div>
      </section>

      {bill.latest_action && (
        <section className="latest">
          <div className="latest-head">
            <h2 className="latest-label">Latest action</h2>
            {bill.latest_action_date && <time className="latest-date">{formatDate(bill.latest_action_date)}{quiet !== null && <span> ({quiet === 0 ? "today" : `${quiet} day${quiet === 1 ? "" : "s"} ago`})</span>}</time>}
          </div>
          <p className="latest-text">{bill.latest_action}</p>
          <VoteBadge text={bill.latest_action} />
          <Explainer text={bill.latest_action} billType={bill.bill_type} />
        </section>
      )}

      <div className="tabs no-print" role="tablist" aria-label="Bill sections">
        {TABS.map((t) => {
          const count =
            t.id === "history" ? allActions.length :
            t.id === "text" ? (texts?.length ?? 0) + votes.length + (hasCbo ? 1 : 0) :
            t.id === "coverage" ? hearingRows.length + (news?.length ?? 0) + record.length : 0;
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? " is-active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}{count > 0 && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* ── Overview ── */}
      <div data-billpanel hidden={tab !== "overview"} className="panel-stack">
        {summaries === null ? (
          <div className="skel skel-block" />
        ) : summaries.length > 0 ? (
          <section className="card summary">
            <div className="card-head">
              <h2 className="card-title">What the bill does</h2>
              <span className="source-tag">Official CRS summary</span>
            </div>
            <p className="card-sub">{summaries[0].actionDesc}{summaries[0].actionDate ? `, ${formatDate(summaries[0].actionDate)}` : ""}</p>
            <ExpandableText text={summaries[0].text} className="official-text" limit={700} />
            {summaries.length > 1 && (
              <details className="details">
                <summary>{summaries.length - 1} earlier version{summaries.length > 2 ? "s" : ""} of the summary</summary>
                {summaries.slice(1).map((s, i) => (
                  <div key={i} className="details-item">
                    <p className="card-sub">{s.actionDesc}</p>
                    <ExpandableText text={s.text} className="official-text" />
                  </div>
                ))}
              </details>
            )}
          </section>
        ) : (
          <section className="card">
            <h2 className="card-title">What the bill does</h2>
            <p className="muted">The Congressional Research Service hasn't published a summary yet. Summaries usually appear a few weeks after introduction.</p>
          </section>
        )}

        <section className="card">
          <MomentumSignals
            introducedDate={bill.raw_snapshot?.introducedDate}
            latestActionDate={bill.latest_action_date}
            cosponsorBreakdown={breakdown}
            cosponsorEventCount={events.filter((e) => e.event_type === "cosponsor_change").length}
          />
        </section>

        <section className="card">
          <h2 className="card-title">Changes we've recorded</h2>
          <p className="card-sub">Everything our daily check has picked up since this bill was first tracked.</p>
          {events.length === 0 ? (
            <p className="muted">Nothing yet. Changes appear here as congress.gov reports them.</p>
          ) : (
            <ul className="mini-timeline">
              {events.slice(0, 12).map((e) => (
                <li key={e.id} className={`mt-item mt-${e.event_type}`}>
                  <time>{formatDate(eventDate(e))}</time>
                  <div>
                    <span className="mt-type">{EVENT_TYPE_LABELS[e.event_type] ?? "Update"}</span>
                    <p>{e.summary}</p>
                    <VoteBadge text={e.summary} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {related && related.length > 0 && (
          <section className="card">
            <h2 className="card-title">Related bills</h2>
            <p className="card-sub">Companion or identical bills identified by Congress or CRS.</p>
            <ul className="related">
              {related.map((r, i) => {
                const rid = `${r.type.toLowerCase()}-${r.number}-${r.congress}`;
                return (
                  <li key={i}>
                    <span className="cite">{citationFor(rid)}</span>
                    <Link href={`/bill/${rid}`}>{r.title}</Link>
                    {r.relationshipType && <span className="related-tag">{r.relationshipType}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {/* ── Full history ── */}
      <div data-billpanel hidden={tab !== "history"} className="panel-stack">
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Every action on this bill</h2>
              <p className="card-sub">The complete official record from congress.gov, with what each step means.</p>
            </div>
            <div className="seg" role="group" aria-label="Show">
              <button className={historyFilter === "all" ? "is-on" : ""} onClick={() => setHistoryFilter("all")}>All</button>
              <button className={historyFilter === "major" ? "is-on" : ""} onClick={() => setHistoryFilter("major")}>Major steps</button>
            </div>
          </div>
          {actions === null ? (
            <div className="skel skel-block" />
          ) : historyRows.length === 0 ? (
            <p className="muted">congress.gov hasn't returned any actions for this bill.</p>
          ) : (
            <ol className="history">
              {historyRows.map((a, i) => {
                const plain = explainAction(a.text, bill.bill_type);
                return (
                  <li key={i} className="history-item">
                    <time>{formatDate(a.actionDate)}</time>
                    <div className="history-body">
                      {a.chamber && <span className="history-chamber">{a.chamber.replace(/ (floor )?actions?$/i, "").replace("Library of Congress", "Congress.gov")}</span>}
                      <p>{a.text}</p>
                      <VoteBadge text={a.text} />
                      {plain && <p className="history-plain">{plain}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {/* ── Text & votes ── */}
      <div data-billpanel hidden={tab !== "text"} className="panel-stack">
        {/* Only mounted once the tab is opened, so the comparison isn't fetched for every page view. */}
        {tab === "text" && texts !== null && <TextChanges billId={billId} versionCount={texts.length} />}
        <section className="card">
          <h2 className="card-title">Bill text</h2>
          <p className="card-sub">The actual legislative language, every published version.</p>
          {texts === null ? <div className="skel skel-row" /> : texts.length === 0 ? (
            <p className="muted">No text published yet. The Government Publishing Office usually posts it within a few days of introduction.</p>
          ) : (
            <ul className="doc-list">
              {texts.map((v, i) => (
                <li key={i}>
                  <span className="doc-name">{v.type}</span>
                  {v.date && <span className="doc-date">{formatDate(v.date)}</span>}
                  <span className="doc-links">{v.formats.map((f, fi) => <a key={fi} href={f.url} target="_blank" rel="noreferrer">{f.type}</a>)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">CBO cost estimate</h2>
          <p className="card-sub">The Congressional Budget Office scores nearly every bill a committee reports out.</p>
          {hasCbo ? (
            <ul className="doc-list">
              {meta!.cboCostEstimates.map((c: { title: string | null; description: string | null; url: string | null; date: string | null }, i: number) => (
                <li key={i}>
                  <span className="doc-name">{c.description ?? c.title ?? "Cost estimate"}</span>
                  {c.date && <span className="doc-date">{formatDate(c.date)}</span>}
                  {c.url && <span className="doc-links"><a href={c.url} target="_blank" rel="noreferrer">Read on cbo.gov</a></span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No estimate yet. CBO usually publishes one after a committee votes to report the bill.</p>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">Recorded votes</h2>
          {actions === null ? <div className="skel skel-row" /> : votes.length === 0 ? (
            <p className="muted">No recorded floor votes yet.</p>
          ) : (
            <ul className="vote-list">
              {votes.map((a, i) => (
                <li key={i}>
                  <time>{formatDate(a.actionDate)}</time>
                  <p>{a.text}</p>
                  <VoteBadge text={a.text} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── People & money ── */}
      <div data-billpanel hidden={tab !== "people"} className="panel-stack">
        {breakdown && (
          <section className="card">
            <PartyBreakdownChart counts={{ D: breakdown.D, R: breakdown.R, I: breakdown.I }} title="Cosponsors by party" capped={breakdown.capped} />
          </section>
        )}
        <BillClients billId={billId} />
        <MemberPositions billId={billId} />
        {lobbying.length > 0 ? (
          <BillLobbyingSection filings={lobbying} />
        ) : (
          <section className="card">
            <h2 className="card-title">Lobbying</h2>
            <p className="muted">No lobbying disclosures on LDA.gov mention this bill by number.</p>
          </section>
        )}
      </div>

      {/* ── Hearings & news ── */}
      <div data-billpanel hidden={tab !== "coverage"} className="panel-stack">
        <section className="card">
          <h2 className="card-title">Hearings</h2>
          {committees === null ? <div className="skel skel-row" /> : hearingRows.length === 0 ? (
            <p className="muted">No hearings recorded for this bill. Most bills never get one.</p>
          ) : (
            <>
              <p className="card-sub">Official committee activity. Witness statements are linked when the committee posted them; full transcripts usually take months.</p>
              <ul className="hearings">
                {hearingRows.map(({ c, a }, i) => {
                  const d = hearings?.find((h) => h.date === a.date && h.committeeName === c.committeeName);
                  return (
                    <li key={`${c.committeeName}-${a.date}-${i}`} className="hearing">
                      <div className="hearing-top">
                        <span className="hearing-committee">{c.committeeName}</span>
                        <time>{formatDate(a.date)}</time>
                      </div>
                      {d?.title && <p className="hearing-title">{d.title}</p>}
                      {d?.location && <p className="muted">{d.location}</p>}
                      {d?.videoUrl && <a href={d.videoUrl} target="_blank" rel="noreferrer">Watch video</a>}
                      {d && d.witnesses.length > 0 && (
                        <ul className="witnesses">
                          {d.witnesses.map((w, wi) => (
                            <li key={wi}>
                              <strong>{w.name}</strong>
                              {(w.position || w.organization) && <span>{[w.position, w.organization].filter(Boolean).join(", ")}</span>}
                              {w.statementUrl && <a href={w.statementUrl} target="_blank" rel="noreferrer">Prepared statement</a>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
        {record.length > 0 && <BillRecordSection mentions={record} />}
        {news === null ? <div className="skel skel-block" /> : news.length > 0 ? <BillNewsSection newsItems={news} /> : (
          <section className="card">
            <h2 className="card-title">In the news</h2>
            <p className="muted">No news coverage found that mentions this bill.</p>
          </section>
        )}
      </div>

      {/* ── Team notes ── */}
      <div data-billpanel hidden={tab !== "workspace"} className="panel-stack">
        <BillWorkspace billId={billId} />
      </div>
    </div>
  );
}

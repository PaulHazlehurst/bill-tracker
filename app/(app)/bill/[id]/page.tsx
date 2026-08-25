"use client";

// Session-dependent (tracking state, notify toggles) - no static version.
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import { useUI } from "@/components/UIProvider";
import { STAGE_LABELS, extractMeta, formatDate, timeAgo, parseVoteInfo, EVENT_TYPE_ICONS, avatarColorFor, initialsFor, faviconFor } from "@/lib/billMeta";
import { recordView } from "@/lib/recentlyViewed";
import { hasSeenEnactedCelebration, markEnactedCelebrationSeen } from "@/lib/celebrationTracker";
import Confetti from "@/components/Confetti";
import { PartyPopper } from "lucide-react";
import { useTicker } from "@/lib/useTicker";
import { TrendingUp, FileText, Users, Circle, ExternalLink, Printer, Check, Share2, ScrollText } from "lucide-react";
import PartyBreakdownChart from "@/components/PartyBreakdownChart";
import ExpandableText from "@/components/ExpandableText";
import MemberPositions from "@/components/MemberPositions";
import MomentumSignals from "@/components/MomentumSignals";

const TIMELINE_ICONS: Record<string, any> = { "trending-up": TrendingUp, "file-text": FileText, "users": Users };

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

type BillEvent = {
  id: string;
  event_type: string;
  summary: string;
  occurred_at: string;
};

type RelatedBill = {
  congress: number;
  type: string;
  number: string;
  title: string;
  latestActionText: string | null;
  relationshipType: string | null;
};

type BillActionItem = {
  actionDate: string;
  text: string;
  type: string | null;
  hasRecordedVote: boolean;
};

type CommitteeActivityItem = {
  committeeName: string;
  chamber: string;
  activities: { date: string; name: string }[];
};

type HearingDetailItem = {
  date: string;
  committeeName: string;
  title: string | null;
  meetingType: string | null;
  location: string | null;
  witnesses: { name: string; position: string | null; organization: string | null; statementUrl: string | null }[];
  videoUrl: string | null;
  documents: { name: string; description: string | null; type: string | null; url: string | null }[];
};

type BillSummaryItem = { text: string; actionDesc: string; actionDate: string; updateDate: string };

type RecordMentionItem = { title: string; date: string | null; section: string | null; url: string | null };

type TextVersionItem = { type: string; date: string | null; formats: { type: string; url: string }[] };

type NewsItemType = { title: string; source: string; url: string; publishedAt: string | null };

type LobbyingFilingItem = {
  filingUuid: string;
  filingYear: number;
  filingType: string;
  registrantName: string;
  clientName: string;
  issueDescription: string;
  documentUrl: string;
};

const STAGE_ORDER = ["introduced", "committee", "passed_house", "passed_senate", "to_president", "enacted"];

function VoteBadge({ text }: { text: string | null | undefined }) {
  const vote = parseVoteInfo(text);
  if (!vote) return null;
  return (
    <div className="vote-badge">
      <span className="yea">{vote.yea} Yea</span>
      <span>·</span>
      <span className="nay">{vote.nay} Nay</span>
      {vote.rollNumber && <span className="muted">· Roll call #{vote.rollNumber}</span>}
    </div>
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
  const [showCelebration, setShowCelebration] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [events, setEvents] = useState<BillEvent[]>([]);
  const [related, setRelated] = useState<RelatedBill[] | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(true);
  const [cosponsorBreakdown, setCosponsorBreakdown] = useState<{ D: number; R: number; I: number; capped: boolean } | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(true);
  const [actions, setActions] = useState<BillActionItem[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [committees, setCommittees] = useState<CommitteeActivityItem[]>([]);
  const [committeesLoading, setCommitteesLoading] = useState(true);
  const [hearingDetails, setHearingDetails] = useState<HearingDetailItem[]>([]);
  const [hearingDetailsLoading, setHearingDetailsLoading] = useState(true);
  const [summaries, setSummaries] = useState<BillSummaryItem[]>([]);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [lobbyingFilings, setLobbyingFilings] = useState<LobbyingFilingItem[]>([]);
  const [recordMentions, setRecordMentions] = useState<RecordMentionItem[]>([]);
  const [recordMentionsLoading, setRecordMentionsLoading] = useState(true);
  const [textVersions, setTextVersions] = useState<TextVersionItem[]>([]);
  const [textVersionsLoading, setTextVersionsLoading] = useState(true);
  const [newsItems, setNewsItems] = useState<NewsItemType[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [trackedRowId, setTrackedRowId] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const [{ data: billData, error: billError }, { data: eventData }, { data: trackedData }] = await Promise.all([
      supabase.from("bills").select("*").eq("id", billId).single(),
      supabase.from("bill_events").select("id, event_type, summary, occurred_at").eq("bill_id", billId).order("occurred_at", { ascending: false }),
      supabase.from("tracked_bills").select("id, notify_email, notify_sms").eq("bill_id", billId).eq("user_id", user.id).maybeSingle(),
    ]);

    if (billError || !billData) {
      setError(billError?.message ?? "Bill not found");
      setLoading(false);
      return;
    }

    setBill(billData as Bill);
    recordView(billId, billData.title);

    if (billData.status_stage === "enacted" && !hasSeenEnactedCelebration(billId)) {
      setShowCelebration(true);
      markEnactedCelebrationSeen(billId);
    }
    setEvents((eventData as BillEvent[]) ?? []);
    if (trackedData) {
      setTrackedRowId(trackedData.id);
      setNotifyEmail(trackedData.notify_email);
      setNotifySms(trackedData.notify_sms);
    } else {
      setTrackedRowId(null);
    }
    setLoading(false);

    fetch(`/api/bills/related?billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`)
      .then((r) => r.json())
      .then((body) => setRelated(body.related ?? []))
      .catch(() => setRelated([]))
      .finally(() => setRelatedLoading(false));

    fetch(`/api/bills/cosponsor-breakdown?billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`)
      .then((r) => r.json())
      .then((body) => setCosponsorBreakdown(body.breakdown ?? null))
      .catch(() => setCosponsorBreakdown(null))
      .finally(() => setBreakdownLoading(false));

    fetch(`/api/bills/actions?billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`)
      .then((r) => r.json())
      .then((body) => setActions(body.actions ?? []))
      .catch(() => setActions([]))
      .finally(() => setActionsLoading(false));

    fetch(`/api/bills/committee-activity?billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`)
      .then((r) => r.json())
      .then((body) => setCommittees(body.committees ?? []))
      .catch(() => setCommittees([]))
      .finally(() => setCommitteesLoading(false));

    // The expensive part of this (listing and checking committee-meeting
    // candidates) only happens server-side if the committee activity we
    // already cached actually has a "Hearings by" entry to look for - a
    // bill with no hearings costs almost nothing here even though this
    // fetch always fires. See findMatchingHearingDetails in congress-api.ts.
    fetch(`/api/bills/hearing-details?billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`)
      .then((r) => r.json())
      .then((body) => setHearingDetails(body.hearings ?? []))
      .catch(() => setHearingDetails([]))
      .finally(() => setHearingDetailsLoading(false));

    fetch(`/api/bills/summaries?billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`)
      .then((r) => r.json())
      .then((body) => setSummaries(body.summaries ?? []))
      .catch(() => setSummaries([]))
      .finally(() => setSummariesLoading(false));

    // Best-effort and quiet - see the honesty note in lib/lda-api.ts. A
    // failure or empty result here should never be visibly alarming; most
    // bills won't have matched lobbying activity, and that's normal.
    fetch(`/api/bills/lobbying-activity?billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`)
      .then((r) => (r.ok ? r.json() : { filings: [] }))
      .then((body) => setLobbyingFilings(body.filings ?? []))
      .catch(() => setLobbyingFilings([]));

    // Best-effort, quiet on failure - GovInfo's Search Service is a
    // "public preview" per their own docs, see lib/govinfo-api.ts.
    fetch(`/api/bills/congressional-record?billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`)
      .then((r) => (r.ok ? r.json() : { mentions: [] }))
      .then((body) => setRecordMentions(body.mentions ?? []))
      .catch(() => setRecordMentions([]))
      .finally(() => setRecordMentionsLoading(false));

    fetch(`/api/bills/text-versions?billId=${billId}&congress=${billData.congress}&billType=${billData.bill_type}&billNumber=${billData.bill_number}`)
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((body) => setTextVersions(body.versions ?? []))
      .catch(() => setTextVersions([]))
      .finally(() => setTextVersionsLoading(false));

    fetch(`/api/bills/news?billId=${billId}&title=${encodeURIComponent(billData.title)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((body) => setNewsItems(body.items ?? []))
      .catch(() => setNewsItems([]))
      .finally(() => setNewsLoading(false));
  }

  useEffect(() => {
    load();
  }, [billId]);

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
      toast("Now tracking this bill", "success");
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      toast(body.error ?? "Couldn't track that bill", "error");
    }
  }

  function handleCopyShareLink() {
    const url = `${window.location.origin}/share/bill/${billId}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  }

  async function handleUntrack() {
    if (!trackedRowId || !bill) return;
    if (!(await confirm(`Stop tracking "${bill.title}"?`, { confirmLabel: "Stop tracking", danger: true }))) return;
    setBusy(true);
    const res = await fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(trackedRowId)}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setTrackedRowId(null);
      toast("Stopped tracking", "info");
    } else {
      toast("Couldn't untrack that bill - try again.", "error");
    }
  }

  async function toggle(field: "notify_email" | "notify_sms", value: boolean) {
    if (field === "notify_email") setNotifyEmail(value);
    else setNotifySms(value);
    await fetch("/api/bills/toggle-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        billId,
        notifyEmail: field === "notify_email" ? value : notifyEmail,
        notifySms: field === "notify_sms" ? value : notifySms,
      }),
    });
  }

  if (loading) {
    return <Spinner label="Loading bill…" large />;
  }

  if (error || !bill) {
    return (
      <div className="container-wide">
        <p className="error-text">Couldn't load this bill{error ? `: ${error}` : "."}</p>
        <a href="/dashboard">← Back to your bills</a>
      </div>
    );
  }

  const meta = extractMeta(bill.raw_snapshot);
  const stageIndex = STAGE_ORDER.indexOf(bill.status_stage);
  const recentlyChecked = bill.last_polled_at && Date.now() - new Date(bill.last_polled_at).getTime() < 5 * 60_000;

  return (
    <div className="container-wide">
      <a href="/dashboard" className="muted" style={{ display: "inline-block", marginBottom: 16 }}>← Back to your bills</a>

      {showCelebration && (
        <>
          <Confetti />
          <div className="enacted-banner no-print">
            <PartyPopper size={20} className="muted" style={{ color: "var(--pos-support)" }} />
            <span><strong>This bill is now law.</strong> Congratulations on tracking it all the way through.</span>
          </div>
        </>
      )}

      <span className={`pill pill-${bill.status_stage}`}>{STAGE_LABELS[bill.status_stage] ?? bill.status_stage}</span>
      <h1 style={{ fontFamily: "var(--font-display), Georgia, serif", fontSize: '2.25rem', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, margin: "14px 0 8px", maxWidth: 720 }}>{bill.title}</h1>
      <p className="muted" style={{ marginBottom: 4 }}>
        {bill.bill_type.toUpperCase()} {bill.bill_number} · {bill.congress}th Congress
      </p>
      {timeAgo(bill.last_polled_at) && (
        <p className="muted" style={{ fontSize: '0.75rem' }}>
          {recentlyChecked && <span className="live-dot" />}
          Last checked {timeAgo(bill.last_polled_at)}
        </p>
      )}
      <VoteBadge text={bill.latest_action} />
      <div style={{ marginTop: 10, display: "flex", gap: 8 }} className="no-print">
        {bill.congress_url && (
          <a href={bill.congress_url} target="_blank" rel="noreferrer" className="external-link-btn">
            <ExternalLink size={13} /> View on congress.gov
          </a>
        )}
        <button className="ghost" onClick={() => window.print()}>
          <Printer size={13} style={{ marginRight: 6, verticalAlign: -2 }} /> Print brief
        </button>
        <button className="ghost" onClick={handleCopyShareLink}>
          <Share2 size={13} style={{ marginRight: 6, verticalAlign: -2 }} /> {shareCopied ? "Link copied!" : "Share"}
        </button>
      </div>

      {/* Stage tracker */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="journey-track">
          <div className="journey-line">
            <div
              className="journey-line-fill"
              style={{ width: `${(Math.max(stageIndex, 0) / (STAGE_ORDER.length - 1)) * 100}%` }}
            />
          </div>
          <div className="journey-steps">
            {STAGE_ORDER.map((s, i) => {
              const done = i < stageIndex;
              const current = i === stageIndex;
              return (
                <div key={s} className="journey-step">
                  <div className={`journey-circle ${done ? "journey-done" : current ? "journey-current" : "journey-future"}`}>
                    {done ? <Check size={12} /> : i + 1}
                  </div>
                  <div className={`journey-label ${i <= stageIndex ? "journey-label-active" : ""}`}>
                    {STAGE_LABELS[s]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick-jump strip - the direct answer to "we have to scroll for a
          while": every section that actually has content gets a link here,
          so getting to lobbying activity or news doesn't mean scrolling
          past everything else first. Sections with no data for this bill
          are simply omitted, not shown greyed-out. */}
      <div className="jump-nav">
        {textVersions.length > 0 && <a href="#section-text">Full text</a>}
        {meta?.cboCostEstimates && meta.cboCostEstimates.length > 0 && <a href="#section-cbo">CBO estimate</a>}
        {summaries.length > 0 && <a href="#section-summary">Summary</a>}
        {meta && <a href="#section-details">Details</a>}
        {lobbyingFilings.length > 0 && <a href="#section-lobbying">Lobbying</a>}
        {recordMentions.length > 0 && <a href="#section-record">Congressional Record</a>}
        {newsItems.length > 0 && <a href="#section-news">News</a>}
        {committees.some((c) => c.activities.some((a) => a.name === "Hearings by")) && <a href="#section-hearings">Hearings</a>}
      </div>

      {/* Two-column layout: quick-reference facts (Details, CBO estimate)
          sit in a sticky sidebar instead of stacking above everything else -
          the direct fix for "the linear lineup of bill information." Main
          narrative content (summary, text, lobbying, news, hearings) flows
          in the wider column beside it. Stacks to a single column on
          mobile via CSS, sidebar first. */}
      <div className="bill-layout">
        <aside className="bill-sidebar">
{meta && (
        <div className="card" id="section-details">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 10 }}>Details</h2>
          <div className="bill-meta" style={{ marginTop: 0 }}>
            {meta.chamber && <span>Chamber: <strong>{meta.chamber}</strong></span>}
            {meta.sponsorName && (
              <span>Sponsor: <strong>{meta.sponsorName}{meta.sponsorParty && meta.sponsorState ? ` (${meta.sponsorParty}-${meta.sponsorState})` : ""}</strong></span>
            )}
            {meta.introducedDate && <span>Introduced: <strong>{meta.introducedDate}</strong></span>}
            {meta.policyArea && <span>Policy area: <strong>{meta.policyArea}</strong></span>}
            {typeof meta.cosponsorCount === "number" && <span>Cosponsors: <strong>{meta.cosponsorCount}</strong></span>}
            {typeof meta.committeeCount === "number" && <span>Committees: <strong>{meta.committeeCount}</strong></span>}
          </div>
        </div>
      )}

      {meta && meta.cboCostEstimates && meta.cboCostEstimates.length > 0 && (
        <div className="card" id="section-cbo">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>CBO cost estimate</h2>
          <p className="settings-desc">
            The Congressional Budget Office is required by law to cost nearly every bill a committee reports out.
          </p>
          {meta.cboCostEstimates.map((c: { title: string | null; description: string | null; url: string | null; date: string | null }, i: number) => (
            <div key={i} className="text-version-row">
              <div>
                <span className="text-version-type">{c.description ?? c.title ?? "Cost estimate"}</span>
                {c.date && <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 8 }}>{formatDate(c.date)}</span>}
              </div>
              {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-version-link">Read on CBO.gov</a>}
            </div>
          ))}
        </div>
      )}
        </aside>
        <div className="bill-main">
      {/* Full legislative text - the actual bill language, not the
          plain-language summary. This is the direct answer to "why not
          just read it on congress.gov" - now you don't have to leave to
          get the real document. */}
      {!textVersionsLoading && textVersions.length > 0 && (
        <div className="card" id="section-text">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>Full text</h2>
          <p className="settings-desc">The actual legislative language, every published version.</p>
          <div>
            {textVersions.map((v, i) => (
              <div key={i} className="text-version-row">
                <div>
                  <span className="text-version-type">{v.type}</span>
                  {v.date && <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 8 }}>{formatDate(v.date)}</span>}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  {v.formats.map((f, fi) => (
                    <a key={fi} href={f.url} target="_blank" rel="noreferrer" className="text-version-link">
                      {f.type}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

            {/* Summary - official CRS-authored plain language, the single most
          useful "what does this bill actually do" content on the page.
          Shows the most recent version; earlier ones (if the bill changed
          significantly) are available but collapsed by default. */}
      {!summariesLoading && summaries.length > 0 && (
        <div className="card summary-card" id="section-summary">
          <div className="summary-card-header">
            <h2 style={{ fontSize: '1rem', fontWeight: 500, margin: 0 }}>Summary</h2>
            <span className="summary-source-badge">CRS Official</span>
          </div>
          <p className="settings-desc">{summaries[0].actionDesc}</p>
          <div className="summary-quote-mark">"</div>
          <ExpandableText text={summaries[0].text} className="official-text" />
          {summaries.length > 1 && (
            <details style={{ marginTop: 10 }}>
              <summary className="muted" style={{ fontSize: '0.75rem', cursor: "pointer" }}>
                {summaries.length - 1} earlier summar{summaries.length - 1 > 1 ? "ies" : "y"}
              </summary>
              {summaries.slice(1).map((s, i) => (
                <div key={i} style={{ marginTop: 10 }}>
                  <p className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>{s.actionDesc}</p>
                  <ExpandableText text={s.text} className="official-text" />
                </div>
              ))}
            </details>
          )}
        </div>
      )}

      {/* Related bills */}
      {!relatedLoading && related && related.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>Related bills</h2>
          <p className="settings-desc">Companion or identical bills identified by Congress or CRS.</p>
          <div>
            {related.map((r, i) => (
              <div key={i} className="related-bill-row">
                <a href={`https://www.congress.gov/bill/${r.congress}th-congress/${r.type.toLowerCase()}/${r.number}`} target="_blank" rel="noreferrer" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.type.toUpperCase()} {r.number}: {r.title}
                </a>
                {r.relationshipType && <span className="related-bill-tag">{r.relationshipType}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cosponsors by party */}
      {!breakdownLoading && cosponsorBreakdown && (
        <div className="card">
          <PartyBreakdownChart
            counts={{ D: cosponsorBreakdown.D, R: cosponsorBreakdown.R, I: cosponsorBreakdown.I }}
            title="Cosponsors by party"
            capped={cosponsorBreakdown.capped}
          />
        </div>
      )}

      {/* Lobbying activity (LDA.gov) - shown only when we found something,
          silent otherwise. Best-effort text match, not exhaustive - see
          lib/lda-api.ts. */}
      {lobbyingFilings.length > 0 && (
        <div className="card" id="section-lobbying">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>Lobbying activity</h2>
          <p className="settings-desc">
            Filings that mention this bill, via LDA.gov (the official House/Senate lobbying disclosure database). Best-effort text match - may not be exhaustive.
          </p>
          <div className="entity-grid">
            {lobbyingFilings.map((f) => (
              <details key={f.filingUuid} className="entity-card">
                <summary className="entity-card-summary">
                  <span className="entity-avatar" style={{ background: avatarColorFor(f.clientName) }}>
                    {initialsFor(f.clientName)}
                  </span>
                  <span>
                    <span className="entity-card-name">{f.clientName}</span>
                    <span className="entity-card-meta">via {f.registrantName} · {f.filingYear}</span>
                  </span>
                </summary>
                <p style={{ fontSize: '0.8125rem', marginTop: 10, lineHeight: 1.5 }}>{f.issueDescription}</p>
                <a href={f.documentUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', display: "inline-block", marginTop: 4 }}>
                  View filing →
                </a>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* Congressional Record mentions - what a representative actually
          said on the floor about this bill, official and verbatim. GovInfo's
          Search Service is a "public preview" per their own docs, so this
          is best-effort like the lobbying section above it. */}
      {!recordMentionsLoading && recordMentions.length > 0 && (
        <div className="card" id="section-record">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>Congressional Record mentions</h2>
          <p className="settings-desc">
            Floor speeches and remarks that mention this bill, straight from the official record. Best-effort search - may not be exhaustive.
          </p>
          <div className="entity-grid">
            {recordMentions.map((m, i) => (
              <a key={i} href={m.url ?? undefined} target="_blank" rel="noreferrer" className="entity-card">
                <span className="entity-card-summary">
                  <span className="entity-avatar" style={{ background: avatarColorFor(m.section ?? "Record") }}>
                    <ScrollText size={16} />
                  </span>
                  <span>
                    <span className="entity-card-name">{m.title}</span>
                    <span className="entity-card-meta">{m.section ?? "Congressional Record"}{m.date && ` · ${formatDate(m.date)}`}</span>
                  </span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Related news coverage - real article links only, never reproduced
          text. Google News RSS is a public feed, not a formal API - see
          lib/newsFeed-api.ts for the honest terms this runs under. Favicons
          are honestly sourced from the article's real URL, unlike the
          lobbyist avatars above which use initials since no real domain
          exists to derive a logo from. */}
      {!newsLoading && newsItems.length > 0 && (
        <div className="card" id="section-news">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>Related news coverage</h2>
          <p className="settings-desc">
            Real articles mentioning this bill, linked directly - read the actual reporting, not a summary of it.
          </p>
          <div className="entity-grid">
            {newsItems.map((n, i) => {
              const favicon = faviconFor(n.url);
              return (
                <a key={i} href={n.url} target="_blank" rel="noreferrer" className="entity-card news-card">
                  <span className="entity-card-summary">
                    {favicon ? (
                      <img src={favicon} alt="" className="news-favicon" />
                    ) : (
                      <span className="entity-avatar" style={{ background: "var(--text-soft)" }}>{initialsFor(n.source)}</span>
                    )}
                    <span>
                      <span className="entity-card-name">{n.title}</span>
                      <span className="entity-card-meta">{n.source}{n.publishedAt && ` · ${formatDate(n.publishedAt)}`}</span>
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Hearings - dated committee activity history, enriched with witness
          detail wherever we could confidently match a specific meeting
          record (see findMatchingHearingDetails). Both layers shown
          together: the reliable dates always show, rich detail only when found.
          Always renders once loaded (even with nothing to show) so this
          doesn't silently disappear and look like a missing feature. */}
      {committeesLoading ? (
        <div className="card" id="section-hearings">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>Hearings</h2>
          <p className="muted" style={{ fontSize: '0.8125rem' }}>Checking committee records…</p>
        </div>
      ) : !committees.some((c) => c.activities.some((a) => a.name === "Hearings by")) ? (
        <div className="card" id="section-hearings">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>Hearings</h2>
          <p className="muted" style={{ fontSize: '0.8125rem' }}>No hearings recorded for this bill yet. Most bills never reach one.</p>
        </div>
      ) : (
        <div className="card" id="section-hearings">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>Hearings</h2>
          <p className="settings-desc">
            Official committee activity from congress.gov.
            {!hearingDetailsLoading && hearingDetails.length > 0 && " Detail (witnesses, documents) shown where we could confidently match a specific meeting."}
            {" "}Full hearing transcripts aren't shown here - they're published by GPO at each committee's discretion, typically months to years later. Witness prepared statements, when available, are usually posted within days and linked below.
          </p>
          <div>
            {committees.flatMap((c) =>
              c.activities
                .filter((a) => a.name === "Hearings by")
                .map((a, i) => {
                  const detail = hearingDetails.find((h) => h.date === a.date && h.committeeName === c.committeeName);
                  return (
                    <div key={`${c.committeeName}-${a.date}-${i}`} className="hearing-row">
                      <div className="hearing-header">
                        <span className="hearing-committee">{c.committeeName}</span>
                        <span className="hearing-date">{formatDate(a.date)}</span>
                        {detail && <span className="hearing-detail-badge">Detail found</span>}
                      </div>
                      {detail?.title && <div className="hearing-title">{detail.title}</div>}
                      {detail?.location && <div className="muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>{detail.location}</div>}
                      {detail?.videoUrl && (
                        <a href={detail.videoUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', display: "inline-block", marginTop: 4 }}>
                          Watch video →
                        </a>
                      )}
                      {detail && detail.witnesses.length > 0 && (
                        <div className="witness-list">
                          {detail.witnesses.map((w, wi) => (
                            <div key={wi} className="witness-row">
                              <span className="witness-name">{w.name}</span>
                              {(w.position || w.organization) && (
                                <div className="witness-role">{[w.position, w.organization].filter(Boolean).join(", ")}</div>
                              )}
                              {w.statementUrl && (
                                <a href={w.statementUrl} target="_blank" rel="noreferrer" className="witness-statement-link">
                                  Read prepared statement →
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {detail && detail.documents.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          {detail.documents.map((doc, di) => (
                            <div key={di} style={{ fontSize: '0.75rem', marginTop: 2 }}>
                              {doc.url ? (
                                <a href={doc.url} target="_blank" rel="noreferrer">{doc.name}</a>
                              ) : (
                                <span className="muted">{doc.name}</span>
                              )}
                              {doc.type && <span className="muted"> · {doc.type}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
          {hearingDetailsLoading && <p className="muted" style={{ fontSize: '0.75rem', marginTop: 8 }}>Looking for additional hearing detail…</p>}
        </div>
      )}

      {/* Momentum signals - transparent facts, not a prediction */}
      <div className="card">
        <MomentumSignals
          introducedDate={bill.raw_snapshot?.introducedDate}
          latestActionDate={bill.latest_action_date}
          cosponsorBreakdown={cosponsorBreakdown}
          cosponsorEventCount={events.filter((e) => e.event_type === "cosponsor_change").length}
        />
      </div>

      {/* Vote history - the FULL history, not just what our poller happened to catch */}
      {!actionsLoading && actions.some((a) => a.hasRecordedVote || parseVoteInfo(a.text)) && (
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>Vote history</h2>
          <p className="settings-desc">Every recorded vote on this bill, most recent first.</p>
          <div>
            {actions
              .filter((a) => a.hasRecordedVote || parseVoteInfo(a.text))
              .map((a, i) => (
                <div key={i} className="vote-history-row">
                  <div>{a.text}</div>
                  <div className="muted" style={{ fontSize: '0.6875rem', marginTop: 2 }}>{formatDate(a.actionDate)}</div>
                  <VoteBadge text={a.text} />
                </div>
              ))}
          </div>
        </div>
      )}

        </div>
      </div>

      {/* Track / notify controls */}
      <div className="card no-print">
        <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 10 }}>Tracking</h2>
        {trackedRowId ? (
          <>
            <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: '0.8125rem' }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={notifyEmail} onChange={(e) => toggle("notify_email", e.target.checked)} />
                Email me
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={notifySms} onChange={(e) => toggle("notify_sms", e.target.checked)} />
                Text me
              </label>
            </div>
            <button className="ghost" onClick={handleUntrack} disabled={busy}>
              {busy ? "Removing…" : "Stop tracking"}
            </button>
          </>
        ) : (
          <button className="primary" onClick={handleTrack} disabled={busy}>
            {busy ? "Adding…" : "Track this bill"}
          </button>
        )}
      </div>

      <MemberPositions billId={billId} />

      {/* Timeline */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 10 }}>Timeline</h2>
        {events.length === 0 ? (
          <p className="muted">
            No changes recorded yet. This fills in automatically once the daily check detects an update to this bill's status.
          </p>
        ) : (
          <div className="member-list">
            {events.map((ev) => {
              const Icon = TIMELINE_ICONS[EVENT_TYPE_ICONS[ev.event_type]] ?? Circle;
              return (
                <div key={ev.id} className="member-row" style={{ alignItems: "flex-start" }}>
                  <Icon size={14} className="muted" style={{ marginTop: 3, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.875rem' }}>{ev.summary}</div>
                    <div className="muted" style={{ fontSize: '0.6875rem' }}>{formatDate(ev.occurred_at)}</div>
                    <VoteBadge text={ev.summary} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

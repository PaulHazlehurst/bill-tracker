"use client";

// Session-dependent (tracking state, notify toggles) - no static version.
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import { STAGE_LABELS, extractMeta, formatDate, timeAgo } from "@/lib/billMeta";

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

const STAGE_ORDER = ["introduced", "committee", "passed_house", "passed_senate", "to_president", "enacted"];

export default function BillDetailPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useParams();
  const billId = params.id as string;

  const [bill, setBill] = useState<Bill | null>(null);
  const [events, setEvents] = useState<BillEvent[]>([]);
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
    setEvents((eventData as BillEvent[]) ?? []);
    if (trackedData) {
      setTrackedRowId(trackedData.id);
      setNotifyEmail(trackedData.notify_email);
      setNotifySms(trackedData.notify_sms);
    } else {
      setTrackedRowId(null);
    }
    setLoading(false);
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
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      window.alert(body.error ?? "Couldn't track that bill");
    }
  }

  async function handleUntrack() {
    if (!trackedRowId || !bill) return;
    if (!window.confirm(`Stop tracking "${bill.title}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(trackedRowId)}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setTrackedRowId(null);
    } else {
      window.alert("Couldn't untrack that bill - try again.");
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

  return (
    <div className="container-wide">
      <a href="/dashboard" className="muted" style={{ display: "inline-block", marginBottom: 16 }}>← Back to your bills</a>

        <span className="pill">{STAGE_LABELS[bill.status_stage] ?? bill.status_stage}</span>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: "10px 0 6px" }}>{bill.title}</h1>
        <p className="muted" style={{ marginBottom: 4 }}>
          {bill.bill_type.toUpperCase()} {bill.bill_number} · {bill.congress}th Congress
        </p>
        {timeAgo(bill.last_polled_at) && (
          <p className="muted" style={{ fontSize: '0.75rem' }}>Last checked {timeAgo(bill.last_polled_at)}</p>
        )}

        {/* Stage tracker */}
        <div className="card" style={{ marginTop: 20 }}>
          <div className="progress-track" style={{ marginBottom: 10 }}>
            <div className="progress-fill" style={{ width: `${bill.progress_pct}%` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
            {STAGE_ORDER.map((s, i) => (
              <span
                key={s}
                className="muted"
                style={{
                  fontSize: '0.6875rem',
                  color: i <= stageIndex ? "var(--accent)" : undefined,
                  fontWeight: i <= stageIndex ? 500 : undefined,
                }}
              >
                {STAGE_LABELS[s]}
              </span>
            ))}
          </div>
        </div>

        {meta && (
          <div className="card">
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
            {meta.summary && <p style={{ marginTop: 12, fontSize: '0.875rem' }}>{meta.summary}</p>}
            {bill.congress_url && (
              <a href={bill.congress_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10, fontSize: '0.8125rem' }}>
                View full text and details on congress.gov →
              </a>
            )}
          </div>
        )}

        {/* Track / notify controls */}
        <div className="card">
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

        {/* Timeline */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 10 }}>Timeline</h2>
          {events.length === 0 ? (
            <p className="muted">
              No changes recorded yet. This fills in automatically once the daily check detects an update to this bill's status.
            </p>
          ) : (
            <div className="member-list">
              {events.map((ev) => (
                <div key={ev.id} className="member-row" style={{ alignItems: "flex-start" }}>
                  <div className="member-avatar" style={{ marginTop: 2 }}>•</div>
                  <div>
                    <div style={{ fontSize: '0.875rem' }}>{ev.summary}</div>
                    <div className="muted" style={{ fontSize: '0.6875rem' }}>{formatDate(ev.occurred_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
    </div>
  );
}

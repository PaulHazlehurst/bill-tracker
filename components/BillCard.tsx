"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STAGE_LABELS, extractMeta, timeAgo } from "@/lib/billMeta";

type BillDetail = {
  title: string;
  status_stage: string;
  progress_pct: number;
  latest_action: string | null;
  latest_action_date: string | null;
  congress_url: string | null;
  raw_snapshot: any | null;
  last_polled_at: string | null;
};

export type TrackedBillRow = {
  id: string;
  bill_id: string;
  notify_email: boolean;
  notify_sms: boolean;
  bills: BillDetail | BillDetail[] | null;
};

export default function BillCard({
  row,
  editable = true,
  index = 0,
  onUntrack,
}: {
  row: TrackedBillRow;
  editable?: boolean;
  index?: number;
  onUntrack?: () => void;
}) {
  const [notifyEmail, setNotifyEmail] = useState(row.notify_email);
  const [notifySms, setNotifySms] = useState(row.notify_sms);
  const [untracking, setUntracking] = useState(false);
  const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;

  if (!bill) return null;

  const meta = extractMeta(bill.raw_snapshot);

  async function toggle(field: "notify_email" | "notify_sms", value: boolean) {
    if (field === "notify_email") setNotifyEmail(value);
    else setNotifySms(value);

    await fetch("/api/bills/toggle-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        billId: row.bill_id,
        notifyEmail: field === "notify_email" ? value : notifyEmail,
        notifySms: field === "notify_sms" ? value : notifySms,
      }),
    });
  }

  async function handleUntrack() {
    if (!window.confirm(`Stop tracking "${bill!.title}"? You can always track it again later.`)) return;
    setUntracking(true);
    const res = await fetch(`/api/bills/track?trackedBillId=${encodeURIComponent(row.id)}`, { method: "DELETE" });
    if (res.ok) {
      onUntrack?.();
    } else {
      setUntracking(false);
      window.alert("Couldn't untrack that bill - try again.");
    }
  }

  return (
    <div className="card hoverable card-enter" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <span className="pill">{STAGE_LABELS[bill.status_stage] ?? bill.status_stage}</span>
          <h3 style={{ fontSize: '1rem', fontWeight: 500, margin: "8px 0 4px" }}>
            <a href={`/bill/${row.bill_id}`} style={{ textDecoration: "none" }}>{bill.title}</a>
          </h3>
          {bill.latest_action && <p className="muted">{bill.latest_action}</p>}
        </div>
        {bill.congress_url && (
          <a href={bill.congress_url} target="_blank" rel="noreferrer" className="muted" style={{ whiteSpace: "nowrap" }}>
            View on congress.gov
          </a>
        )}
      </div>

      {meta && (
        <div className="bill-meta">
          {meta.chamber && <span>Chamber: <strong>{meta.chamber}</strong></span>}
          {meta.sponsorName && (
            <span>
              Sponsor: <strong>{meta.sponsorName}{meta.sponsorParty && meta.sponsorState ? ` (${meta.sponsorParty}-${meta.sponsorState})` : ""}</strong>
            </span>
          )}
          {meta.introducedDate && <span>Introduced: <strong>{meta.introducedDate}</strong></span>}
          {meta.policyArea && <span>Policy area: <strong>{meta.policyArea}</strong></span>}
          {typeof meta.cosponsorCount === "number" && <span>Cosponsors: <strong>{meta.cosponsorCount}</strong></span>}
        </div>
      )}

      <div style={{ margin: "14px 0 6px" }}>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${bill.progress_pct}%` }} />
        </div>
      </div>

      {editable && (
        <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: '0.8125rem' }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={notifyEmail} onChange={(e) => toggle("notify_email", e.target.checked)} />
            Email me
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={notifySms} onChange={(e) => toggle("notify_sms", e.target.checked)} />
            Text me
          </label>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        {timeAgo(bill.last_polled_at) && (
          <span className="muted" style={{ fontSize: '0.6875rem' }}>Checked {timeAgo(bill.last_polled_at)}</span>
        )}
        {editable && (
          <button className="ghost" onClick={handleUntrack} disabled={untracking} style={{ fontSize: '0.75rem', padding: "5px 10px" }}>
            {untracking ? "Removing…" : "Stop tracking"}
          </button>
        )}
      </div>
    </div>
  );
}

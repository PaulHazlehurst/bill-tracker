"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type TrackedBillRow = {
  bill_id: string;
  notify_email: boolean;
  notify_sms: boolean;
  bills: {
    title: string;
    status_stage: string;
    progress_pct: number;
    latest_action: string | null;
    latest_action_date: string | null;
    congress_url: string | null;
  } | null;
};

const STAGE_LABELS: Record<string, string> = {
  introduced: "Introduced",
  committee: "In committee",
  passed_house: "Passed House",
  passed_senate: "Passed Senate",
  to_president: "Sent to President",
  enacted: "Enacted",
  vetoed: "Vetoed",
  failed: "Failed",
};

export default function BillCard({ row, editable = true }: { row: TrackedBillRow; editable?: boolean }) {
  const supabase = createClient();
  const [notifyEmail, setNotifyEmail] = useState(row.notify_email);
  const [notifySms, setNotifySms] = useState(row.notify_sms);
  const bill = row.bills;

  if (!bill) return null;

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

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <span className="pill">{STAGE_LABELS[bill.status_stage] ?? bill.status_stage}</span>
          <h3 style={{ fontSize: 16, fontWeight: 500, margin: "8px 0 4px" }}>{bill.title}</h3>
          {bill.latest_action && <p className="muted">{bill.latest_action}</p>}
        </div>
        {bill.congress_url && (
          <a href={bill.congress_url} target="_blank" rel="noreferrer" className="muted" style={{ whiteSpace: "nowrap" }}>
            View on congress.gov
          </a>
        )}
      </div>

      <div style={{ margin: "14px 0 6px" }}>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${bill.progress_pct}%` }} />
        </div>
      </div>

      {editable && (
        <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 13 }}>
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
    </div>
  );
}

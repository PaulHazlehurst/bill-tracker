"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type BillDetail = {
  title: string;
  status_stage: string;
  progress_pct: number;
  latest_action: string | null;
  latest_action_date: string | null;
  congress_url: string | null;
  raw_snapshot: any | null;
};

export type TrackedBillRow = {
  bill_id: string;
  notify_email: boolean;
  notify_sms: boolean;
  bills: BillDetail | BillDetail[] | null;
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

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

// Pulls the extra descriptive fields (sponsor, chamber, policy area,
// cosponsor count) out of the raw congress.gov snapshot we already store -
// no extra API calls needed, this data was fetched once when the bill was
// first tracked.
function extractMeta(raw: any) {
  if (!raw) return null;
  const sponsor = raw.sponsors?.[0];
  return {
    chamber: raw.originChamber ?? null,
    introducedDate: formatDate(raw.introducedDate),
    policyArea: raw.policyArea?.name ?? null,
    sponsorName: sponsor?.fullName ?? (sponsor ? `${sponsor.firstName ?? ""} ${sponsor.lastName ?? ""}`.trim() : null),
    sponsorParty: sponsor?.party ?? null,
    sponsorState: sponsor?.state ?? null,
    cosponsorCount: raw.cosponsors?.count ?? null,
  };
}

export default function BillCard({
  row,
  editable = true,
  index = 0,
}: {
  row: TrackedBillRow;
  editable?: boolean;
  index?: number;
}) {
  const supabase = createClient();
  const [notifyEmail, setNotifyEmail] = useState(row.notify_email);
  const [notifySms, setNotifySms] = useState(row.notify_sms);
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

  return (
    <div className="card hoverable card-enter" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <span className="pill">{STAGE_LABELS[bill.status_stage] ?? bill.status_stage}</span>
          <h3 style={{ fontSize: '1rem', fontWeight: 500, margin: "8px 0 4px" }}>{bill.title}</h3>
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
    </div>
  );
}

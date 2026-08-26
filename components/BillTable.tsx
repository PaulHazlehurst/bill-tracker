"use client";

import { useState } from "react";
import { STAGE_LABELS, extractMeta, timeAgo, parseVoteInfo } from "@/lib/billMeta";
import { useUI } from "@/components/UIProvider";
import { ThumbsUp, ThumbsDown, Eye, Minus, ExternalLink } from "lucide-react";

const POSITION_ICONS: Record<string, any> = { support: ThumbsUp, oppose: ThumbsDown, watching: Eye, none: Minus };

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

export type TableRow = {
  id: string;
  bill_id: string;
  user_id?: string;
  notify_email: boolean;
  notify_sms: boolean;
  position: string;
  bills: BillDetail | BillDetail[] | null;
};

const POSITION_LABELS: Record<string, string> = {
  support: "Support",
  oppose: "Oppose",
  watching: "Watching",
  none: "No position",
};

function downloadCsv(rows: TableRow[], filename: string) {
  const header = ["Bill", "Position", "Stage", "Progress %", "Link"];
  const lines = [header, ...rows.map((r) => {
    const bill = Array.isArray(r.bills) ? r.bills[0] : r.bills;
    return [bill?.title ?? "", POSITION_LABELS[r.position] ?? r.position, bill?.status_stage ?? "", String(bill?.progress_pct ?? ""), bill?.congress_url ?? ""];
  })];
  const csv = lines.map((line) => line.map((v) => (/[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BillTable({
  rows,
  editable = true,
  trackerEmails,
  selfId,
  onUntrack,
  onBulkUntrack,
}: {
  rows: TableRow[];
  editable?: boolean;
  trackerEmails?: Record<string, string>;
  selfId?: string | null;
  onUntrack?: (trackedBillId: string) => void;
  onBulkUntrack?: (trackedBillIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { confirm } = useUI();
  const [busyId, setBusyId] = useState<string | null>(null);
  const displayRows = rows;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === displayRows.length) setSelected(new Set());
    else setSelected(new Set(displayRows.map((r) => r.id)));
  }

  async function changePosition(row: TableRow, position: string) {
    setBusyId(row.id);
    await fetch("/api/bills/set-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billId: row.bill_id, position }),
    });
    setBusyId(null);
    row.position = position; // optimistic, mutating the passed-in row is fine here since parent re-renders from its own source of truth on next load
  }

  async function changeNotify(row: TableRow, field: "notify_email" | "notify_sms", value: boolean) {
    await fetch("/api/bills/toggle-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        billId: row.bill_id,
        notifyEmail: field === "notify_email" ? value : row.notify_email,
        notifySms: field === "notify_sms" ? value : row.notify_sms,
      }),
    });
    if (field === "notify_email") row.notify_email = value;
    else row.notify_sms = value;
  }

  async function handleUntrack(row: TableRow) {
    const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
    if (!(await confirm(`Stop tracking "${bill?.title}"?`, { confirmLabel: "Stop tracking", danger: true }))) return;
    onUntrack?.(row.id);
  }

  async function handleBulkUntrack() {
    if (selected.size === 0) return;
    if (!(await confirm(`Stop tracking ${selected.size} bill${selected.size > 1 ? "s" : ""}?`, { confirmLabel: "Stop tracking", danger: true }))) return;
    onBulkUntrack?.(Array.from(selected));
    setSelected(new Set());
  }

  if (displayRows.length === 0) return null;

  return (
    <div>
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" onClick={() => downloadCsv(displayRows.filter((r) => selected.has(r.id)), "selected-bills.csv")}>
              Export selected
            </button>
            {selected.size >= 2 && selected.size <= 4 && (
              <a href={`/compare?ids=${displayRows.filter((r) => selected.has(r.id)).map((r) => r.bill_id).join(",")}`}>
                <button className="primary">Compare selected</button>
              </a>
            )}
            {editable && <button className="ghost" onClick={handleBulkUntrack}>Stop tracking selected</button>}
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="bill-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={selected.size === displayRows.length && displayRows.length > 0} onChange={toggleSelectAll} />
              </th>
              <th>Bill</th>
              <th>Position</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Sponsor</th>
              {trackerEmails && <th>Tracked by</th>}
              <th>Checked</th>
              {editable && <th>Notify</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
              if (!bill) return null;
              const meta = extractMeta(bill.raw_snapshot);
              const trackerEmail = trackerEmails && row.user_id ? trackerEmails[row.user_id] : undefined;
              // Show a pulse dot for bills with activity in the last 48 hours
              const isRecent = bill.latest_action_date && (Date.now() - new Date(bill.latest_action_date).getTime()) < 48 * 60 * 60 * 1000;

              return (
                <tr key={row.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} />
                  </td>
                  <td className="bill-table-title">
                    <a href={`/bill/${row.bill_id}`}>{bill.title}</a>
                    {isRecent && <span className="activity-pulse" title="Activity in the last 48 hours" />}
                    {bill.congress_url && (
                      <a
                        href={bill.congress_url}
                        target="_blank"
                        rel="noreferrer"
                        className="row-external-link"
                        title="View on congress.gov"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <select
                        className={`position-select position-${row.position}`}
                        defaultValue={row.position}
                        disabled={busyId === row.id}
                        onChange={(e) => changePosition(row, e.target.value)}
                      >
                        <option value="none">No position</option>
                        <option value="support">Support</option>
                        <option value="oppose">Oppose</option>
                        <option value="watching">Watching</option>
                      </select>
                    ) : (
                      <span className={`badge-position badge-${row.position}`}>
                        {(() => { const Icon = POSITION_ICONS[row.position]; return Icon ? <Icon size={11} style={{ marginRight: 4, verticalAlign: -1 }} /> : null; })()}
                        {POSITION_LABELS[row.position]}
                      </span>
                    )}
                  </td>
                  <td><span className={`pill pill-${bill.status_stage}`}>{STAGE_LABELS[bill.status_stage] ?? bill.status_stage}</span></td>
                  <td style={{ minWidth: 90 }}>
                    <div className="progress-track" style={{ height: 6 }}>
                      <div className="progress-fill" style={{ width: `${bill.progress_pct}%` }} />
                    </div>
                  </td>
                  <td className="muted" style={{ fontSize: '0.75rem' }}>{meta?.sponsorName ?? "—"}</td>
                  {trackerEmails && (
                    <td className="muted" style={{ fontSize: '0.75rem' }}>
                      {trackerEmail ? `${trackerEmail}${row.user_id === selfId ? " (you)" : ""}` : "—"}
                    </td>
                  )}
                  <td className="muted" style={{ fontSize: '0.75rem', whiteSpace: "nowrap" }}>{timeAgo(bill.last_polled_at) ?? "—"}</td>
                  {editable && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <label title="Email me" style={{ cursor: "pointer" }}>
                          <input type="checkbox" defaultChecked={row.notify_email} onChange={(e) => changeNotify(row, "notify_email", e.target.checked)} />
                        </label>
                        <span className="muted" style={{ fontSize: '0.6875rem' }}>✉</span>
                        <label title="Text me" style={{ cursor: "pointer" }}>
                          <input type="checkbox" defaultChecked={row.notify_sms} onChange={(e) => changeNotify(row, "notify_sms", e.target.checked)} />
                        </label>
                        <span className="muted" style={{ fontSize: '0.6875rem' }}>✆</span>
                      </div>
                    </td>
                  )}
                  <td>
                    {editable && (
                      <button className="ghost" style={{ fontSize: '0.6875rem', padding: "4px 8px" }} onClick={() => handleUntrack(row)}>
                        Untrack
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

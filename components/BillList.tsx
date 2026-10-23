"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useUI } from "@/components/UIProvider";
import RouteLine, { StagePill } from "@/components/ui/RouteLine";
import { citationFor, extractMeta, formatDate, daysSince, publicBillUrl } from "@/lib/billMeta";
import { MoreHorizontal, Mail, MessageSquare, ExternalLink, Trash2, Download, Columns3, X } from "lucide-react";

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
  created_at?: string;
  bills: BillDetail | BillDetail[] | null;
};

export const POSITION_LABELS: Record<string, string> = {
  support: "Support",
  oppose: "Oppose",
  watching: "Watching",
  none: "No position",
};

// A bill counts as "gone quiet" after this long without any congressional action.
export { QUIET_DAYS } from "@/lib/billStage";
import { QUIET_DAYS } from "@/lib/billStage";

export function billOf(row: TableRow): BillDetail | null {
  return (Array.isArray(row.bills) ? row.bills[0] : row.bills) ?? null;
}

export function downloadCsv(rows: TableRow[], filename: string) {
  const header = ["Citation", "Title", "Position", "Stage", "Latest action", "Latest action date", "Sponsor", "Link"];
  const lines = [
    header,
    ...rows.map((r) => {
      const b = billOf(r);
      const meta = extractMeta(b?.raw_snapshot);
      return [citationFor(r.bill_id), b?.title ?? "", POSITION_LABELS[r.position] ?? r.position, b?.status_stage ?? "", b?.latest_action ?? "", b?.latest_action_date ?? "", meta?.sponsorName ?? "", publicBillUrl(r.bill_id)];
    }),
  ];
  // Cells starting with = + - @ would run as spreadsheet formulas; prefix them.
  const cell = (raw: string) => {
    const v = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[,"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const csv = lines.map((line) => line.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BillList({
  rows,
  editable = true,
  trackerEmails,
  selfId,
  onUntrack,
  onBulkUntrack,
  animate = false,
}: {
  rows: TableRow[];
  editable?: boolean;
  trackerEmails?: Record<string, string>;
  selfId?: string | null;
  onUntrack?: (trackedBillId: string) => void;
  onBulkUntrack?: (trackedBillIds: string[]) => void;
  animate?: boolean;
}) {
  const { confirm, toast } = useUI();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, force] = useState(0);

  // Drop selections for rows that were filtered away.
  useEffect(() => {
    setSelected((prev) => new Set(Array.from(prev).filter((id) => rows.some((r) => r.id === id))));
  }, [rows]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function changePosition(row: TableRow, position: string) {
    const previous = row.position;
    row.position = position;
    force((n) => n + 1);
    const res = await fetch("/api/bills/set-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billId: row.bill_id, position }),
    });
    if (!res.ok) {
      row.position = previous;
      force((n) => n + 1);
      toast("Couldn't save that position. Try again.", "error");
    }
  }

  async function changeNotify(row: TableRow, field: "notify_email" | "notify_sms", value: boolean) {
    const prev = row[field];
    row[field] = value;
    force((n) => n + 1);
    const res = await fetch("/api/bills/toggle-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billId: row.bill_id, notifyEmail: row.notify_email, notifySms: row.notify_sms }),
    });
    if (!res.ok) {
      row[field] = prev;
      force((n) => n + 1);
      toast("Couldn't update alerts for that bill.", "error");
    }
  }

  async function untrack(row: TableRow) {
    const b = billOf(row);
    if (!(await confirm(`Stop tracking ${citationFor(row.bill_id)}${b?.title ? `, “${b.title}”` : ""}?`, { confirmLabel: "Stop tracking", danger: true }))) return;
    onUntrack?.(row.id);
  }

  async function bulkUntrack() {
    if (!(await confirm(`Stop tracking ${selected.size} bill${selected.size > 1 ? "s" : ""}?`, { confirmLabel: "Stop tracking", danger: true }))) return;
    onBulkUntrack?.(Array.from(selected));
    setSelected(new Set());
  }

  if (rows.length === 0) return null;
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = selected.size === rows.length;

  return (
    <div className="bill-list-wrap">
      <div className="bill-list-head">
        <label className="check" title={allSelected ? "Clear selection" : "Select all"}>
          <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all bills" />
        </label>
        <span>Bill and progress</span>
        <span className="bl-col-pos">{editable ? "Your position" : "Position"}</span>
        <span className="bl-col-menu" />
      </div>

      <ul className="bill-list">
        {rows.map((row) => {
          const b = billOf(row);
          if (!b) return null;
          const type = row.bill_id.split("-")[0];
          const quietDays = daysSince(b.latest_action_date);
          const isQuiet = quietDays !== null && quietDays >= QUIET_DAYS && !["enacted", "agreed", "vetoed", "failed"].includes(b.status_stage);
          const isFresh = quietDays !== null && quietDays <= 2;
          const tracker = trackerEmails && row.user_id ? trackerEmails[row.user_id] : undefined;
          return (
            <li key={row.id} className={`bill-row${selected.has(row.id) ? " is-selected" : ""}`}>
              <label className="check">
                <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${citationFor(row.bill_id)}`} />
              </label>

              <div className="bill-row-main">
                <div className="bill-row-meta">
                  <span className="cite">{citationFor(row.bill_id)}</span>
                  <StagePill stage={b.status_stage} />
                  {isFresh && <span className="flag flag-fresh">New activity</span>}
                  {isQuiet && <span className="flag flag-quiet" title={`No congressional action in ${quietDays} days`}>Quiet {Math.round(quietDays! / 30)} mo</span>}
                </div>
                <Link href={`/bill/${row.bill_id}`} className="bill-row-title">{b.title}</Link>
                <div className="bill-row-route">
                  <RouteLine stage={b.status_stage} billType={type} animate={animate} />
                </div>
                {b.latest_action && (
                  <p className="bill-row-action">
                    {b.latest_action_date && <time dateTime={b.latest_action_date}>{formatDate(b.latest_action_date)}</time>}
                    <span>{b.latest_action}</span>
                  </p>
                )}
                {tracker && <p className="bill-row-tracker">Tracked by {tracker}{row.user_id === selfId ? " (you)" : ""}</p>}
              </div>

              <div className="bl-col-pos">
                {editable ? (
                  <select className={`pos-select pos-${row.position}`} value={row.position} onChange={(e) => changePosition(row, e.target.value)} aria-label={`Your position on ${citationFor(row.bill_id)}`}>
                    <option value="none">No position</option>
                    <option value="support">Support</option>
                    <option value="oppose">Oppose</option>
                    <option value="watching">Watching</option>
                  </select>
                ) : (
                  <span className={`pos-tag pos-${row.position}`}>{POSITION_LABELS[row.position] ?? row.position}</span>
                )}
              </div>

              <div className="bl-col-menu">
                <RowMenu
                  row={row}
                  editable={editable}
                  onNotify={(f, v) => changeNotify(row, f, v)}
                  onUntrack={() => untrack(row)}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {selected.size > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Selected bills">
          <span className="bulk-count">{selected.size} selected</span>
          <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(selectedRows, "selected-bills.csv")}><Download size={14} /> Export</button>
          {selected.size >= 2 && selected.size <= 4 ? (
            <Link className="btn btn-ghost btn-sm" href={`/compare?ids=${selectedRows.map((r) => r.bill_id).join(",")}`}><Columns3 size={14} /> Compare</Link>
          ) : (
            <span className="bulk-hint">Select 2–4 to compare</span>
          )}
          {editable && onBulkUntrack && <button className="btn btn-ghost btn-sm btn-danger-text" onClick={bulkUntrack}><Trash2 size={14} /> Stop tracking</button>}
          <button className="icon-btn" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

function RowMenu({
  row,
  editable,
  onNotify,
  onUntrack,
}: {
  row: TableRow;
  editable: boolean;
  onNotify: (field: "notify_email" | "notify_sms", value: boolean) => void;
  onUntrack: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="row-menu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={`Options for ${citationFor(row.bill_id)}`} aria-expanded={open}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="menu menu-right" role="menu">
          {editable && (
            <>
              <label className="menu-item menu-toggle">
                <Mail size={15} /> Email alerts
                <input type="checkbox" className="switch" checked={row.notify_email} onChange={(e) => onNotify("notify_email", e.target.checked)} />
              </label>
              <label className="menu-item menu-toggle">
                <MessageSquare size={15} /> Text alerts
                <input type="checkbox" className="switch" checked={row.notify_sms} onChange={(e) => onNotify("notify_sms", e.target.checked)} />
              </label>
              <div className="menu-sep" />
            </>
          )}
          <a className="menu-item" href={publicBillUrl(row.bill_id)} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> View on congress.gov
          </a>
          {editable && (
            <button className="menu-item menu-danger" onClick={() => { setOpen(false); onUntrack(); }}>
              <Trash2 size={15} /> Stop tracking
            </button>
          )}
        </div>
      )}
    </div>
  );
}

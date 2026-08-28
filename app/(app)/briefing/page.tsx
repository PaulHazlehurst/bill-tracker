"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { extractMeta, STAGE_LABELS, formatDate } from "@/lib/billMeta";
import { Printer, Download, ArrowLeft } from "lucide-react";
import Spinner from "@/components/Spinner";

type BillRow = {
  bill_id: string;
  position: string;
  bills: {
    title: string;
    status_stage: string;
    progress_pct: number;
    latest_action: string | null;
    latest_action_date: string | null;
    congress_url: string | null;
    raw_snapshot: any;
    last_polled_at: string | null;
  } | any[] | null;
};

type RecentEvent = {
  bill_id: string;
  event_type: string;
  summary: string;
  occurred_at: string;
};

type BriefingData = {
  orgName: string | null;
  userEmail: string;
  generatedAt: string;
  bills: BillRow[];
  recentEvents: RecentEvent[];
};

const POSITION_LABELS: Record<string, string> = {
  support: "Support",
  oppose: "Oppose",
  watching: "Watching",
  none: "No position",
};

// A clean, professional report page designed specifically for printing
// to PDF or presenting to stakeholders. No interactive widgets — just
// information, structured for a non-technical audience who needs to
// understand where their legislative portfolio stands right now.
export default function BriefingPage() {
  const [data, setData] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/briefing")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="container-wide"><Spinner label="Loading briefing…" large /></div>;
  if (!data || data.bills.length === 0) return (
    <div className="container" style={{ padding: 40 }}>
      <p>No tracked bills to include in a briefing. Track some bills first, then come back here.</p>
      <a href="/dashboard"><button className="primary"><ArrowLeft size={14} /> Back to dashboard</button></a>
    </div>
  );

  const bills = data.bills.map((row) => {
    const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
    return { ...row, bill };
  }).filter((r) => r.bill);

  // Group by position for the executive summary
  const byPosition = { support: 0, oppose: 0, watching: 0, none: 0 };
  const byStage: Record<string, number> = {};
  for (const r of bills) {
    byPosition[r.position as keyof typeof byPosition] = (byPosition[r.position as keyof typeof byPosition] ?? 0) + 1;
    const stage = r.bill.status_stage ?? "unknown";
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }

  const genDate = new Date(data.generatedAt);
  const dateStr = genDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="briefing-page">
      {/* Print controls — hidden in print output */}
      <div className="briefing-controls no-print">
        <a href="/dashboard" className="briefing-back"><ArrowLeft size={14} /> Dashboard</a>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="primary" onClick={() => window.print()}>
            <Printer size={14} /> Save as PDF
          </button>
        </div>
      </div>

      {/* Report header */}
      <header className="briefing-header">
        <div className="briefing-header-brand">
          <div className="briefing-logo">B</div>
          <div>
            <h1 className="briefing-title">Legislative Portfolio Briefing</h1>
            <p className="briefing-subtitle">
              {data.orgName ?? "Personal Portfolio"} · {dateStr}
            </p>
          </div>
        </div>
        <div className="briefing-meta">
          <span>Prepared by Bill Tracker</span>
          <span>{bills.length} bill{bills.length !== 1 ? "s" : ""} tracked</span>
        </div>
      </header>

      {/* Executive summary */}
      <section className="briefing-section">
        <h2 className="briefing-section-title">Executive Summary</h2>
        <div className="briefing-summary-grid">
          <div className="briefing-summary-card">
            <div className="briefing-summary-number">{bills.length}</div>
            <div className="briefing-summary-label">Bills Tracked</div>
          </div>
          {byPosition.support > 0 && (
            <div className="briefing-summary-card">
              <div className="briefing-summary-number" style={{ color: "var(--pos-support)" }}>{byPosition.support}</div>
              <div className="briefing-summary-label">Supporting</div>
            </div>
          )}
          {byPosition.oppose > 0 && (
            <div className="briefing-summary-card">
              <div className="briefing-summary-number" style={{ color: "var(--pos-oppose)" }}>{byPosition.oppose}</div>
              <div className="briefing-summary-label">Opposing</div>
            </div>
          )}
          {Object.entries(byStage).filter(([, v]) => v > 0).map(([stage, count]) => (
            <div key={stage} className="briefing-summary-card">
              <div className="briefing-summary-number">{count}</div>
              <div className="briefing-summary-label">{STAGE_LABELS[stage] ?? stage}</div>
            </div>
          ))}
        </div>

        {data.recentEvents.length > 0 && (
          <div className="briefing-highlight">
            <strong>{data.recentEvents.length} update{data.recentEvents.length !== 1 ? "s" : ""}</strong> in the last 30 days across your portfolio.
          </div>
        )}
      </section>

      {/* Bill-by-bill detail */}
      <section className="briefing-section">
        <h2 className="briefing-section-title">Bill Details</h2>
        {bills.map((r, i) => {
          const meta = extractMeta(r.bill.raw_snapshot);
          const billEvents = data.recentEvents.filter((e) => e.bill_id === r.bill_id);
          const cboEstimates = meta?.cboCostEstimates?.filter((c: any) => c.title || c.description) ?? [];

          return (
            <div key={r.bill_id} className="briefing-bill-card">
              <div className="briefing-bill-header">
                <div>
                  <span className="briefing-bill-id">{r.bill_id.replace(/-/g, " ").toUpperCase()}</span>
                  <h3 className="briefing-bill-title">{r.bill.title}</h3>
                </div>
                <div className="briefing-bill-status">
                  <span className={`briefing-stage briefing-stage-${r.bill.status_stage}`}>
                    {STAGE_LABELS[r.bill.status_stage] ?? r.bill.status_stage}
                  </span>
                  <span className={`briefing-position briefing-position-${r.position}`}>
                    {POSITION_LABELS[r.position]}
                  </span>
                </div>
              </div>

              <div className="briefing-bill-progress">
                <div className="briefing-progress-track">
                  <div className="briefing-progress-fill" style={{ width: `${r.bill.progress_pct}%` }} />
                </div>
                <span className="briefing-progress-label">{r.bill.progress_pct}%</span>
              </div>

              <div className="briefing-bill-details">
                {meta?.sponsorName && (
                  <div className="briefing-detail-row">
                    <span className="briefing-detail-label">Sponsor</span>
                    <span>{meta.sponsorName} ({meta.sponsorParty}-{meta.sponsorState})</span>
                  </div>
                )}
                {meta?.cosponsorCount != null && (
                  <div className="briefing-detail-row">
                    <span className="briefing-detail-label">Cosponsors</span>
                    <span>{meta.cosponsorCount}</span>
                  </div>
                )}
                {meta?.policyArea && (
                  <div className="briefing-detail-row">
                    <span className="briefing-detail-label">Policy area</span>
                    <span>{meta.policyArea}</span>
                  </div>
                )}
                {meta?.chamber && (
                  <div className="briefing-detail-row">
                    <span className="briefing-detail-label">Chamber</span>
                    <span>{meta.chamber}</span>
                  </div>
                )}
                {r.bill.latest_action && (
                  <div className="briefing-detail-row">
                    <span className="briefing-detail-label">Latest action</span>
                    <span>{r.bill.latest_action} {r.bill.latest_action_date && <span className="muted">({formatDate(r.bill.latest_action_date)})</span>}</span>
                  </div>
                )}
              </div>

              {cboEstimates.length > 0 && (
                <div className="briefing-cbo">
                  <span className="briefing-detail-label">CBO Cost Estimate</span>
                  {cboEstimates.map((c: any, ci: number) => (
                    <p key={ci} className="briefing-cbo-text">{c.description || c.title}</p>
                  ))}
                </div>
              )}

              {billEvents.length > 0 && (
                <div className="briefing-bill-events">
                  <span className="briefing-detail-label">Recent activity (30 days)</span>
                  {billEvents.slice(0, 5).map((e, ei) => (
                    <div key={ei} className="briefing-event-row">
                      <span className="briefing-event-date">{formatDate(e.occurred_at)}</span>
                      <span>{e.summary}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Footer */}
      <footer className="briefing-footer">
        <p>Generated by Bill Tracker on {dateStr}. Data sourced from congress.gov. For the most current information, visit congress.gov directly.</p>
        {data.orgName && <p>{data.orgName} — Confidential</p>}
      </footer>
    </div>
  );
}

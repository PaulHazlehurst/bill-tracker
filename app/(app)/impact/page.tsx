"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Activity, Zap, AlertTriangle, ChevronDown, ChevronRight, FileText, Star, GitBranch } from "lucide-react";
import { STAGE_LABELS } from "@/lib/billMeta";
import Spinner from "@/components/Spinner";

type ImpactBill = {
  billId: string;
  title: string;
  statusStage: string;
  progressPct: number;
  position: string;
  policyArea: string;
  latestAction: string | null;
  latestActionDate: string | null;
  sponsorName: string | null;
  sponsorParty: string | null;
  cosponsorCount: number;
};

type PolicyGroup = {
  policyArea: string;
  count: number;
  avgProgress: number;
  bills: ImpactBill[];
};

type HealthData = {
  score: number;
  advancing: number;
  active: number;
  stalled: number;
  total: number;
  recentEvents: number;
};

const POSITION_LABELS: Record<string, string> = {
  support: "Support",
  oppose: "Oppose",
  watching: "Watching",
  none: "No position",
};

function healthGrade(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "Strong", color: "var(--pos-support)" };
  if (score >= 40) return { label: "Moderate", color: "var(--accent-gold)" };
  return { label: "Needs Attention", color: "var(--pos-oppose)" };
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.round((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

// Cross-Bill Impact Dashboard — the "portfolio manager" view that answers
// "how is my legislative portfolio doing overall?" Groups bills by topic,
// shows a health score, highlights what's moving and what's stuck. The
// kind of view a policy director opens before their weekly team meeting.
export default function ImpactDashboardPage() {
  const [groups, setGroups] = useState<PolicyGroup[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [allBills, setAllBills] = useState<ImpactBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"topics" | "momentum">("topics");

  useEffect(() => {
    fetch("/api/impact")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        setGroups(data.groups ?? []);
        setHealth(data.health ?? null);
        setAllBills(data.bills ?? []);
        setLoading(false);
      })
      .catch(() => { setError("Couldn't load impact data."); setLoading(false); });
  }, []);

  function toggleGroup(area: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(area) ? next.delete(area) : next.add(area);
      return next;
    });
  }

  if (loading) return <div className="container-wide"><Spinner label="Loading impact dashboard…" large /></div>;
  if (error) return (
    <div className="container" style={{ padding: 40 }}>
      <p className="error-text">{error}</p>
      <Link href="/dashboard"><button className="ghost"><ArrowLeft size={14} /> Back to dashboard</button></Link>
    </div>
  );

  if (!health || allBills.length === 0) return (
    <div className="container-wide">
      <div className="empty-cta">
        <div className="empty-cta-icon"><GitBranch size={22} strokeWidth={1.5} /></div>
        <h2 className="section-title" style={{ marginBottom: 6 }}>No portfolio to analyse yet</h2>
        <p className="muted" style={{ margin: "0 0 16px" }}>Impact shows momentum, stalls, and policy overlap across everything you track. Start tracking a few bills and it fills in on its own.</p>
        <Link href="/dashboard"><button className="primary">Go to your bills →</button></Link>
      </div>
    </div>
  );

  const grade = healthGrade(health.score);

  // Split bills by momentum
  const advancing = allBills.filter((b) =>
    ["passed_house", "passed_senate", "to_president", "enacted"].includes(b.statusStage)
  );
  const stalled = allBills.filter((b) => {
    if (["passed_house", "passed_senate", "to_president", "enacted"].includes(b.statusStage)) return false;
    const days = daysSince(b.latestActionDate);
    return days === null || days > 30;
  });
  const active = allBills.filter((b) => {
    if (["passed_house", "passed_senate", "to_president", "enacted"].includes(b.statusStage)) return false;
    const days = daysSince(b.latestActionDate);
    return days !== null && days <= 30;
  });

  return (
    <div className="container-wide">
      <Link href="/dashboard" className="briefing-back" style={{ marginBottom: 20, display: "inline-flex" }}>
        <ArrowLeft size={14} /> Dashboard
      </Link>

      <span className="page-eyebrow">Portfolio Intelligence</span>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 500, marginBottom: 4 }}>Cross-Bill Impact</h1>
      <p className="muted" style={{ marginBottom: 24 }}>How your legislative portfolio is performing across policy areas.</p>

      {/* Health score hero */}
      <div className="impact-health-hero">
        <div className="impact-health-score">
          <div className="impact-health-ring" style={{ "--health-color": grade.color, "--health-pct": `${health.score}%` } as React.CSSProperties}>
            <div className="impact-health-ring-inner">
              <span className="impact-health-number">{health.score}</span>
              <span className="impact-health-label">Health</span>
            </div>
          </div>
          <div className="impact-health-grade" style={{ color: grade.color }}>{grade.label}</div>
        </div>
        <div className="impact-health-breakdown">
          <div className="impact-health-metric">
            <TrendingUp size={16} style={{ color: "var(--pos-support)" }} />
            <div>
              <div className="impact-metric-value">{health.advancing}</div>
              <div className="impact-metric-label">Advancing</div>
            </div>
          </div>
          <div className="impact-health-metric">
            <Activity size={16} style={{ color: "var(--accent-gold)" }} />
            <div>
              <div className="impact-metric-value">{health.active}</div>
              <div className="impact-metric-label">Active</div>
            </div>
          </div>
          <div className="impact-health-metric">
            <AlertTriangle size={16} style={{ color: "var(--pos-oppose)" }} />
            <div>
              <div className="impact-metric-value">{health.stalled}</div>
              <div className="impact-metric-label">Stalled</div>
            </div>
          </div>
          <div className="impact-health-metric">
            <Zap size={16} style={{ color: "var(--text-soft)" }} />
            <div>
              <div className="impact-metric-value">{health.recentEvents}</div>
              <div className="impact-metric-label">Events (30d)</div>
            </div>
          </div>
        </div>
      </div>

      {/* View toggle */}
      <div className="impact-view-tabs">
        <button
          className={`legislator-tab ${view === "topics" ? "legislator-tab-active" : ""}`}
          onClick={() => setView("topics")}
        >
          By policy area ({groups.length})
        </button>
        <button
          className={`legislator-tab ${view === "momentum" ? "legislator-tab-active" : ""}`}
          onClick={() => setView("momentum")}
        >
          By momentum
        </button>
      </div>

      {view === "topics" && (
        <div className="impact-groups">
          {groups.map((group) => {
            const isOpen = expandedGroups.has(group.policyArea);
            return (
              <div key={group.policyArea} className="impact-group-card">
                <button className="impact-group-header" onClick={() => toggleGroup(group.policyArea)}>
                  <div className="impact-group-title">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span>{group.policyArea}</span>
                    <span className="impact-group-count">{group.count}</span>
                  </div>
                  <div className="impact-group-progress">
                    <div className="impact-group-progress-track">
                      <div className="impact-group-progress-fill" style={{ width: `${group.avgProgress}%` }} />
                    </div>
                    <span className="muted" style={{ fontSize: "0.75rem" }}>{group.avgProgress}% avg</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="impact-group-bills">
                    {group.bills.map((b) => (
                      <Link key={b.billId} href={`/bill/${b.billId}`} className="impact-bill-row">
                        <FileText size={14} className="muted" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="impact-bill-title">{b.title}</div>
                          <div className="impact-bill-meta">
                            <span className={`impact-stage impact-stage-${b.statusStage}`}>
                              {STAGE_LABELS[b.statusStage] ?? b.statusStage}
                            </span>
                            {b.sponsorName && <span className="muted">{b.sponsorName}</span>}
                            {b.position !== "none" && (
                              <span className={`impact-position impact-position-${b.position}`}>
                                {POSITION_LABELS[b.position]}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="impact-bill-progress-mini">
                          <div className="impact-mini-track"><div className="impact-mini-fill" style={{ width: `${b.progressPct}%` }} /></div>
                          <span className="muted" style={{ fontSize: "0.7rem" }}>{b.progressPct}%</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view === "momentum" && (
        <div className="impact-momentum">
          {advancing.length > 0 && (
            <div className="impact-momentum-section">
              <h3 className="impact-momentum-title">
                <TrendingUp size={15} style={{ color: "var(--pos-support)" }} /> Advancing ({advancing.length})
              </h3>
              {advancing.map((b) => (
                <Link key={b.billId} href={`/bill/${b.billId}`} className="impact-bill-row impact-bill-advancing">
                  <FileText size={14} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="impact-bill-title">{b.title}</div>
                    <div className="impact-bill-meta">
                      <span className={`impact-stage impact-stage-${b.statusStage}`}>{STAGE_LABELS[b.statusStage] ?? b.statusStage}</span>
                      {b.latestAction && <span className="muted" style={{ fontSize: "0.7rem" }}>{b.latestAction}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {active.length > 0 && (
            <div className="impact-momentum-section">
              <h3 className="impact-momentum-title">
                <Activity size={15} style={{ color: "var(--accent-gold)" }} /> Active ({active.length})
              </h3>
              {active.map((b) => {
                const days = daysSince(b.latestActionDate);
                return (
                  <Link key={b.billId} href={`/bill/${b.billId}`} className="impact-bill-row">
                    <FileText size={14} className="muted" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="impact-bill-title">{b.title}</div>
                      <div className="impact-bill-meta">
                        <span className={`impact-stage impact-stage-${b.statusStage}`}>{STAGE_LABELS[b.statusStage] ?? b.statusStage}</span>
                        {days !== null && <span className="muted">{days}d ago</span>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {stalled.length > 0 && (
            <div className="impact-momentum-section">
              <h3 className="impact-momentum-title">
                <AlertTriangle size={15} style={{ color: "var(--pos-oppose)" }} /> Stalled ({stalled.length})
              </h3>
              {stalled.map((b) => {
                const days = daysSince(b.latestActionDate);
                return (
                  <Link key={b.billId} href={`/bill/${b.billId}`} className="impact-bill-row impact-bill-stalled">
                    <FileText size={14} className="muted" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="impact-bill-title">{b.title}</div>
                      <div className="impact-bill-meta">
                        <span className={`impact-stage impact-stage-${b.statusStage}`}>{STAGE_LABELS[b.statusStage] ?? b.statusStage}</span>
                        {days !== null && <span className="muted">{days}d with no action</span>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

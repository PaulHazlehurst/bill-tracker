"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import CountUp from "@/components/CountUp";
import Reveal from "@/components/Reveal";
import { HeartPulse, Lock, ExternalLink } from "lucide-react";

const STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],
  ["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],
  ["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],
  ["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],
  ["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],
  ["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],
  ["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
] as const;

type Stats = { states: number; documents: number; activities: number; totalStateAward: number; fundingCount: number };
type StateDetail = {
  code: string; name: string; cahCount: number | null; population: number | null; ruralPercent: number | null;
  summary: string | null; documents: number; awardTotal: number; awardeeCount: number;
  recentDocuments: { title: string; fileType: string; category: string; url: string; highlights: string | null }[];
};

function formatMoney(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

export default function RuralHealthPage() {
  const supabase = createClient();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [stateCode, setStateCode] = useState("MD");
  const [stateDetail, setStateDetail] = useState<StateDetail | null>(null);
  const [configured, setConfigured] = useState(true);
  const [stateLoading, setStateLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      fetch("/api/rural-health/stats").then((r) => r.json()).then((b) => setStats(b.stats)).finally(() => setLoading(false));
    })();
  }, []);

  useEffect(() => {
    setStateLoading(true);
    fetch(`/api/rural-health/state?code=${stateCode}`)
      .then((r) => r.json())
      .then((b) => {
        setConfigured(!!b.configured);
        setStateDetail(b.state ?? null);
      })
      .finally(() => setStateLoading(false));
  }, [stateCode]);

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Rural Health</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            The Rural Health Transformation Program (RHTP) - $50B in federal investment to strengthen rural care access, tracked across all 50 states.
          </p>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading…" />
      ) : (
        <>
          {stats && (
            <Reveal>
              <div className="stat-grid">
                <div className="stat-card">
                  <HeartPulse size={15} className="stat-card-icon" />
                  <div className="stat-value"><CountUp value={stats.states} /></div>
                  <div className="stat-label">States tracked</div>
                </div>
                <div className="stat-card">
                  <HeartPulse size={15} className="stat-card-icon" />
                  <div className="stat-value">{formatMoney(stats.totalStateAward)}</div>
                  <div className="stat-label">Total awarded</div>
                </div>
                <div className="stat-card">
                  <HeartPulse size={15} className="stat-card-icon" />
                  <div className="stat-value"><CountUp value={stats.fundingCount} /></div>
                  <div className="stat-label">Funding opportunities</div>
                </div>
                <div className="stat-card">
                  <HeartPulse size={15} className="stat-card-icon" />
                  <div className="stat-value"><CountUp value={stats.documents} /></div>
                  <div className="stat-label">Documents tracked</div>
                </div>
              </div>
              <p className="muted" style={{ fontSize: '0.6875rem', marginTop: 8 }}>
                National totals via Rural Care Journey's public API, aggregated from state and federal sources. Not affiliated with HRSA, CMS, or HHS - verify with official sources before programmatic decisions.
              </p>
            </Reveal>
          )}

          <Reveal delay={80}>
            <div className="card" style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 500, margin: 0 }}>State detail</h2>
                <select className="toolbar-select" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                  {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </div>

              {stateLoading ? (
                <Spinner label="Loading state data…" />
              ) : !configured ? (
                <div className="rural-health-locked">
                  <Lock size={20} className="muted" />
                  <div>
                    <p style={{ margin: "0 0 4px", fontWeight: 500 }}>State-level detail isn't unlocked yet</p>
                    <p className="muted" style={{ margin: 0, fontSize: '0.8125rem' }}>
                      Population, rural facility counts, award history, and program documents for {STATES.find(([c]) => c === stateCode)?.[1]} require a Rural Care Journey API plan.
                    </p>
                    <a href="https://www.ruralcarejourney.com/membership/api" target="_blank" rel="noreferrer" className="external-link-btn" style={{ marginTop: 10 }}>
                      <ExternalLink size={13} /> View API plans
                    </a>
                  </div>
                </div>
              ) : stateDetail ? (
                <div>
                  {stateDetail.summary && <p style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>{stateDetail.summary}</p>}
                  <div className="bill-meta" style={{ marginTop: 8 }}>
                    {stateDetail.cahCount !== null && <span>Critical access hospitals: <strong>{stateDetail.cahCount}</strong></span>}
                    {stateDetail.ruralPercent !== null && <span>Rural population: <strong>{stateDetail.ruralPercent}%</strong></span>}
                    <span>Total awarded: <strong>{formatMoney(stateDetail.awardTotal)}</strong></span>
                    <span>Awardees: <strong>{stateDetail.awardeeCount}</strong></span>
                  </div>
                  {stateDetail.recentDocuments.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <p className="muted" style={{ fontSize: '0.75rem', marginBottom: 6 }}>Recent program documents</p>
                      {stateDetail.recentDocuments.map((d, i) => (
                        <div key={i} style={{ fontSize: '0.8125rem', padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                          <a href={d.url} target="_blank" rel="noreferrer">{d.title}</a>
                          <span className="muted"> · {d.category}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="muted">No data available for this state yet.</p>
              )}
            </div>
          </Reveal>
        </>
      )}
    </div>
  );
}

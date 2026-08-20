"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import CountUp from "@/components/CountUp";
import SimpleBarChart from "@/components/SimpleBarChart";
import Reveal from "@/components/Reveal";
import { HeartPulse, Lock, ExternalLink, AlertTriangle, Stethoscope, Brain } from "lucide-react";

const STATES = [
  ["Alabama","AL"],["Alaska","AK"],["Arizona","AZ"],["Arkansas","AR"],["California","CA"],
  ["Colorado","CO"],["Connecticut","CT"],["Delaware","DE"],["Florida","FL"],["Georgia","GA"],
  ["Hawaii","HI"],["Idaho","ID"],["Illinois","IL"],["Indiana","IN"],["Iowa","IA"],
  ["Kansas","KS"],["Kentucky","KY"],["Louisiana","LA"],["Maine","ME"],["Maryland","MD"],
  ["Massachusetts","MA"],["Michigan","MI"],["Minnesota","MN"],["Mississippi","MS"],["Missouri","MO"],
  ["Montana","MT"],["Nebraska","NE"],["Nevada","NV"],["New Hampshire","NH"],["New Jersey","NJ"],
  ["New Mexico","NM"],["New York","NY"],["North Carolina","NC"],["North Dakota","ND"],["Ohio","OH"],
  ["Oklahoma","OK"],["Oregon","OR"],["Pennsylvania","PA"],["Rhode Island","RI"],["South Carolina","SC"],
  ["South Dakota","SD"],["Tennessee","TN"],["Texas","TX"],["Utah","UT"],["Vermont","VT"],
  ["Virginia","VA"],["Washington","WA"],["West Virginia","WV"],["Wisconsin","WI"],["Wyoming","WY"],
] as const;

type Stats = { states: number; documents: number; activities: number; totalStateAward: number; fundingCount: number };
type HPSAData = {
  state: string; primaryCareHPSAs: number; dentalHPSAs: number; mentalHealthHPSAs: number;
  practitionersNeeded: number; ruralHPSAs: number; nonRuralHPSAs: number; totalPopulation: number;
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
  const [stateName, setStateName] = useState("Maryland");
  const [hpsa, setHpsa] = useState<HPSAData | null>(null);
  const [hpsaLoading, setHpsaLoading] = useState(true);
  const [hpsaError, setHpsaError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      fetch("/api/rural-health/stats").then((r) => r.json()).then((b) => setStats(b.stats)).finally(() => setLoading(false));
    })();
  }, []);

  useEffect(() => {
    setHpsaLoading(true);
    setHpsaError(null);
    fetch(`/api/rural-health/hpsa?state=${encodeURIComponent(stateName)}`)
      .then((r) => r.json())
      .then((b) => {
        if (b.error) setHpsaError(b.error);
        setHpsa(b.hpsa ?? null);
      })
      .catch(() => setHpsaError("Couldn't reach HRSA data"))
      .finally(() => setHpsaLoading(false));
  }, [stateName]);

  const shortageBreakdown = hpsa ? [
    { label: "Primary care", value: hpsa.primaryCareHPSAs },
    { label: "Dental", value: hpsa.dentalHPSAs },
    { label: "Mental health", value: hpsa.mentalHealthHPSAs },
  ] : [];

  const ruralUrban = hpsa ? [
    { label: "Rural", value: hpsa.ruralHPSAs },
    { label: "Non-rural", value: hpsa.nonRuralHPSAs },
  ] : [];

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Rural Health</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Provider shortage areas, funding, and program activity — from HRSA's official federal data and the Rural Health Transformation Program.
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
                  <div className="stat-value">{formatMoney(stats.totalStateAward)}</div>
                  <div className="stat-label">RHTP total awarded</div>
                </div>
                <div className="stat-card">
                  <HeartPulse size={15} className="stat-card-icon" />
                  <div className="stat-value"><CountUp value={stats.states} /></div>
                  <div className="stat-label">States tracked</div>
                </div>
                <div className="stat-card">
                  <HeartPulse size={15} className="stat-card-icon" />
                  <div className="stat-value"><CountUp value={stats.fundingCount} /></div>
                  <div className="stat-label">Funding opportunities</div>
                </div>
                <div className="stat-card">
                  <HeartPulse size={15} className="stat-card-icon" />
                  <div className="stat-value"><CountUp value={stats.documents} /></div>
                  <div className="stat-label">Program documents</div>
                </div>
              </div>
            </Reveal>
          )}

          <Reveal delay={60}>
            <div className="card" style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 500, margin: 0 }}>
                  <AlertTriangle size={16} style={{ color: "var(--pos-oppose)", marginRight: 8, verticalAlign: -2 }} />
                  Health Professional Shortage Areas
                </h2>
                <select className="toolbar-select" value={stateName} onChange={(e) => setStateName(e.target.value)}>
                  {STATES.map(([name]) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <p className="settings-desc" style={{ marginBottom: 16 }}>
                Official HRSA designations — areas where there aren't enough providers to meet basic healthcare needs. Updated daily from data.hrsa.gov.
              </p>

              {hpsaLoading ? (
                <Spinner label="Loading HRSA data…" />
              ) : hpsaError ? (
                <p className="muted">{hpsaError}</p>
              ) : hpsa ? (
                <div>
                  <div className="stat-grid" style={{ marginBottom: 16 }}>
                    <div className="stat-card">
                      <Stethoscope size={15} className="stat-card-icon" />
                      <div className="stat-value"><CountUp value={hpsa.primaryCareHPSAs + hpsa.dentalHPSAs + hpsa.mentalHealthHPSAs} /></div>
                      <div className="stat-label">Total shortage areas</div>
                    </div>
                    <div className="stat-card">
                      <Brain size={15} className="stat-card-icon" />
                      <div className="stat-value"><CountUp value={hpsa.practitionersNeeded} /></div>
                      <div className="stat-label">Practitioners needed</div>
                    </div>
                    <div className="stat-card">
                      <HeartPulse size={15} className="stat-card-icon" />
                      <div className="stat-value">{hpsa.totalPopulation > 0 ? (hpsa.totalPopulation / 1_000_000).toFixed(1) + "M" : "—"}</div>
                      <div className="stat-label">Population in shortage areas</div>
                    </div>
                    <div className="stat-card">
                      <AlertTriangle size={15} className="stat-card-icon" />
                      <div className="stat-value">{hpsa.primaryCareHPSAs + hpsa.dentalHPSAs + hpsa.mentalHealthHPSAs > 0 ? Math.round((hpsa.ruralHPSAs / (hpsa.primaryCareHPSAs + hpsa.dentalHPSAs + hpsa.mentalHealthHPSAs)) * 100) : 0}%</div>
                      <div className="stat-label">Classified rural</div>
                    </div>
                  </div>

                  <div className="widget-grid">
                    <div className="card">
                      <SimpleBarChart data={shortageBreakdown} title="Shortage areas by discipline" color="var(--pos-oppose)" />
                    </div>
                    <div className="card">
                      <SimpleBarChart data={ruralUrban} title="Rural vs. non-rural" color="var(--accent)" />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="muted">No shortage data found for {stateName}.</p>
              )}
            </div>
          </Reveal>

          <p className="muted" style={{ fontSize: '0.6875rem', marginTop: 12 }}>
            HPSA data: HRSA, Bureau of Health Workforce. RHTP data: Rural Care Journey. Neither is affiliated with this application — verify with official sources before programmatic decisions.
          </p>
        </>
      )}
    </div>
  );
}

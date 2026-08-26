"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import CountUp from "@/components/CountUp";
import DonutChart from "@/components/DonutChart";
import RadialProgress from "@/components/RadialProgress";
import Reveal from "@/components/Reveal";
import { AlertTriangle, MapPinned } from "lucide-react";

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
  topCounties: { county: string; count: number }[];
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

  const totalShortage = hpsa ? hpsa.primaryCareHPSAs + hpsa.dentalHPSAs + hpsa.mentalHealthHPSAs : 0;
  const ruralPercent = hpsa && totalShortage > 0 ? Math.round((hpsa.ruralHPSAs / totalShortage) * 100) : 0;

  const disciplineData = hpsa ? [
    { label: "Primary care", value: hpsa.primaryCareHPSAs, color: "#2c5f9e" },
    { label: "Dental", value: hpsa.dentalHPSAs, color: "#a16207" },
    { label: "Mental health", value: hpsa.mentalHealthHPSAs, color: "#6d28d9" },
  ] : [];

  const maxCountyCount = hpsa?.topCounties[0]?.count ?? 1;

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Field data</span>
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
          {/* Chapter 1: the national picture - RHTP funding overview, a
              quiet backdrop before the real focus of the page. */}
          {stats && (
            <Reveal>
              <div className="rh-national-band">
                <div className="rh-national-item">
                  <span className="rh-national-value">{formatMoney(stats.totalStateAward)}</span>
                  <span className="rh-national-label">RHTP total awarded nationally</span>
                </div>
                <div className="rh-national-item">
                  <span className="rh-national-value"><CountUp value={stats.states} /></span>
                  <span className="rh-national-label">States tracked</span>
                </div>
                <div className="rh-national-item">
                  <span className="rh-national-value"><CountUp value={stats.fundingCount} /></span>
                  <span className="rh-national-label">Funding opportunities</span>
                </div>
              </div>
            </Reveal>
          )}

          {/* Chapter 2: the state deep-dive - the real substance of the
              page, built around HRSA's own daily-updated shortage data. */}
          <Reveal delay={60}>
            <div className="rh-state-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 500, margin: 0, fontFamily: 'var(--font-display), Georgia, serif' }}>
                <AlertTriangle size={18} style={{ color: "var(--pos-oppose)", marginRight: 10, verticalAlign: -3 }} />
                Where care is hardest to reach
              </h2>
              <select className="toolbar-select" value={stateName} onChange={(e) => setStateName(e.target.value)}>
                {STATES.map(([name]) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <p className="settings-desc" style={{ marginBottom: 4 }}>
              Official HRSA shortage designations for {stateName} - areas where there aren't enough providers to meet basic healthcare needs. Updated daily from data.hrsa.gov.
            </p>
          </Reveal>

          {hpsaLoading ? (
            <Spinner label="Loading HRSA data…" />
          ) : hpsaError ? (
            <p className="muted" style={{ marginTop: 12 }}>{hpsaError}</p>
          ) : hpsa ? (
            <>
              <Reveal delay={90}>
                <div className="rh-severity-band">
                  <RadialProgress percent={ruralPercent} size={120} strokeWidth={11} color="var(--pos-oppose)" label="Shortage areas, rural" />
                  <div className="rh-severity-facts">
                    <div className="stats-quick-fact">
                      <span className="stats-quick-fact-value"><CountUp value={totalShortage} /></span>
                      <span className="stats-quick-fact-label">Total shortage areas</span>
                    </div>
                    <div className="stats-quick-fact">
                      <span className="stats-quick-fact-value"><CountUp value={hpsa.practitionersNeeded} /></span>
                      <span className="stats-quick-fact-label">Practitioners needed</span>
                    </div>
                    <div className="stats-quick-fact">
                      <span className="stats-quick-fact-value">{hpsa.totalPopulation > 0 ? (hpsa.totalPopulation / 1_000_000).toFixed(1) + "M" : "—"}</span>
                      <span className="stats-quick-fact-label">Population affected</span>
                    </div>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={120}>
                <div className="rh-bento">
                  <div className="stats-bento-cell rh-bento-donut">
                    <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 12 }}>Shortage type</h2>
                    <DonutChart data={disciplineData} />
                  </div>
                  <div className="stats-bento-cell rh-bento-counties">
                    <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 4 }}>
                      <MapPinned size={15} style={{ marginRight: 6, verticalAlign: -2 }} />
                      Highest-need counties
                    </h2>
                    <p className="settings-desc" style={{ marginBottom: 10 }}>
                      Ranked by number of active shortage designations - a real, data-grounded starting point for where attention is most needed, not a precise site recommendation.
                    </p>
                    {hpsa.topCounties.length > 0 ? (
                      <div>
                        {hpsa.topCounties.map((c, i) => (
                          <div key={c.county} className="rh-county-row">
                            <span className="rh-county-rank">{i + 1}</span>
                            <span className="rh-county-name">{c.county}</span>
                            <div className="rh-county-bar-track">
                              <div className="rh-county-bar-fill" style={{ width: `${(c.count / maxCountyCount) * 100}%` }} />
                            </div>
                            <span className="rh-county-count">{c.count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">County-level detail wasn't available for this state.</p>
                    )}
                  </div>
                </div>
              </Reveal>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>No shortage data found for {stateName}.</p>
          )}

          <p className="muted" style={{ fontSize: '0.6875rem', marginTop: 16 }}>
            HPSA data: HRSA, Bureau of Health Workforce. RHTP data: Rural Care Journey. Neither is affiliated with this application — verify with official sources before programmatic decisions.
          </p>
        </>
      )}
    </div>
  );
}

"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import CountUp from "@/components/CountUp";
import SimpleBarChart from "@/components/SimpleBarChart";
import DonutChart from "@/components/DonutChart";
import RadialProgress from "@/components/RadialProgress";
import PositionBreakdown from "@/components/PositionBreakdown";
import PartyBreakdownChart from "@/components/PartyBreakdownChart";
import Reveal from "@/components/Reveal";
import { STAGE_LABELS, extractMeta } from "@/lib/billMeta";
import { BarChart3 } from "lucide-react";

// Matches the exact stage-pill color language from the bill detail page,
// so a color here means the same thing it means everywhere else in the
// app - real visual recognition, not a second, uncoordinated palette.
const STAGE_ORDER = ["introduced", "committee", "passed_house", "passed_senate", "to_president", "enacted"];
const STAGE_COLORS: Record<string, string> = {
  introduced: "#4a5769",
  committee: "#8a5a1a",
  passed_house: "#1d6d3b",
  passed_senate: "#1d6d3b",
  to_president: "#15803d",
  enacted: "#15803d",
};

type Row = {
  bill_id: string;
  position: string;
  bills: { title: string; status_stage: string; raw_snapshot: any; congress: number; bill_type: string } | { title: string; status_stage: string; raw_snapshot: any; congress: number; bill_type: string }[] | null;
};

export default function StatisticsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [scope, setScope] = useState<"yours" | "team">("yours");
  const [rows, setRows] = useState<Row[]>([]);
  const [hasTeam, setHasTeam] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [scope]);

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    setHasTeam(!!profile?.organization_id);

    let query = supabase
      .from("tracked_bills")
      .select("bill_id, position, bills(title, status_stage, raw_snapshot, congress, bill_type)");
    if (scope === "yours") query = query.eq("user_id", user.id);

    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }
    setRows((data as any) ?? []);
    setLoading(false);
  }

  const stageCounts: Record<string, number> = {};
  const positionCounts: Record<string, number> = { support: 0, oppose: 0, watching: 0, none: 0 };
  const partyCounts: Record<string, number> = { D: 0, R: 0, I: 0 };
  const chamberCounts: Record<string, number> = { House: 0, Senate: 0 };
  const policyAreaCounts: Record<string, number> = {};
  const stageBills: Record<string, { id: string; title: string }[]> = {};
  let enactedCount = 0;
  let totalCosponsors = 0;
  let billsWithCosponsorData = 0;

  const byBill = new Map<string, Row>();
  for (const r of rows) {
    positionCounts[r.position] = (positionCounts[r.position] ?? 0) + 1;
    if (!byBill.has(r.bill_id)) byBill.set(r.bill_id, r);
  }

  for (const r of byBill.values()) {
    const bill = Array.isArray(r.bills) ? r.bills[0] : r.bills;
    if (!bill) continue;

    stageCounts[bill.status_stage] = (stageCounts[bill.status_stage] ?? 0) + 1;
    if (!stageBills[bill.status_stage]) stageBills[bill.status_stage] = [];
    stageBills[bill.status_stage].push({ id: r.bill_id, title: bill.title });
    if (bill.status_stage === "enacted") enactedCount++;

    const party = (bill.raw_snapshot?.sponsors?.[0]?.party ?? "").toUpperCase();
    if (party === "D") partyCounts.D++;
    else if (party === "R") partyCounts.R++;
    else if (party) partyCounts.I++;

    const chamber = bill.raw_snapshot?.originChamber;
    if (chamber === "House" || chamber === "Senate") chamberCounts[chamber]++;

    const meta = extractMeta(bill.raw_snapshot);
    if (meta?.policyArea) policyAreaCounts[meta.policyArea] = (policyAreaCounts[meta.policyArea] ?? 0) + 1;
    if (typeof meta?.cosponsorCount === "number") {
      totalCosponsors += meta.cosponsorCount;
      billsWithCosponsorData++;
    }
  }

  const totalBills = byBill.size;
  const successRate = totalBills > 0 ? Math.round((enactedCount / totalBills) * 100) : 0;
  const avgCosponsors = billsWithCosponsorData > 0 ? Math.round(totalCosponsors / billsWithCosponsorData) : 0;
  const activeCount = totalBills - enactedCount;

  const donutData = STAGE_ORDER.map((stage) => ({
    label: STAGE_LABELS[stage] ?? stage,
    value: stageCounts[stage] ?? 0,
    color: STAGE_COLORS[stage],
  }));
  const policyAreaData = Object.entries(policyAreaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));
  const topPolicyArea = policyAreaData[0];

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Portfolio</span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Statistics</h1>
          <p className="muted" style={{ marginTop: 4 }}>A portfolio view across everything tracked.</p>
        </div>
        {hasTeam && (
          <div className="segmented">
            <button className={scope === "yours" ? "segmented-active" : ""} onClick={() => setScope("yours")}>Your bills</button>
            <button className={scope === "team" ? "segmented-active" : ""} onClick={() => setScope("team")}>Team</button>
          </div>
        )}
      </div>

      {loading ? (
        <Spinner label="Crunching numbers…" />
      ) : error ? (
        <p className="error-text">Couldn't load statistics: {error}</p>
      ) : totalBills === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><BarChart3 size={22} strokeWidth={1.5} /></div>
          <p className="muted" style={{ margin: 0 }}>Nothing tracked yet - statistics will show up once you are.</p>
        </div>
      ) : (
        <>
          {/* Narrative hero - the story headline, not just a stat grid.
              Real numbers woven into a sentence, so the first thing you
              read is the takeaway, not a table of raw figures. */}
          <Reveal>
            <div className="stats-hero">
              <p className="stats-hero-headline">
                You're tracking <strong>{totalBills}</strong> bill{totalBills !== 1 ? "s" : ""}
                {enactedCount > 0 && <> — <strong>{enactedCount}</strong> {enactedCount === 1 ? "has" : "have"} become law</>}
                {activeCount > 0 && enactedCount > 0 && <>, <strong>{activeCount}</strong> still moving</>}.
              </p>
              <p className="stats-hero-sub">
                {successRate > 0 && <>A <strong>{successRate}%</strong> success rate so far. </>}
                {topPolicyArea && <>Most of your attention is on <strong>{topPolicyArea.label}</strong>. </>}
                {avgCosponsors > 0 && <>Bills you track average <strong>{avgCosponsors}</strong> cosponsors.</>}
              </p>
            </div>
          </Reveal>

          <Reveal delay={40}>
            <div className="stats-featured">
              <RadialProgress
                percent={successRate}
                size={110}
                strokeWidth={10}
                color="var(--pos-support)"
                label="Reached law"
              />
              <div className="stats-quick-facts">
                <div className="stats-quick-fact">
                  <span className="stats-quick-fact-value"><CountUp value={totalBills} /></span>
                  <span className="stats-quick-fact-label">Bills tracked</span>
                </div>
                <div className="stats-quick-fact">
                  <span className="stats-quick-fact-value"><CountUp value={enactedCount} /></span>
                  <span className="stats-quick-fact-label">Enacted</span>
                </div>
                {avgCosponsors > 0 && (
                  <div className="stats-quick-fact">
                    <span className="stats-quick-fact-value"><CountUp value={avgCosponsors} /></span>
                    <span className="stats-quick-fact-label">Avg. cosponsors</span>
                  </div>
                )}
              </div>
            </div>
          </Reveal>

          {/* Portfolio scatter - every tracked bill plotted along the same
              stage axis used on every individual bill's journey tracker.
              Shows the shape of the whole portfolio at a glance: clustered
              early, spread across the pipeline, or piled up near law. */}
          <Reveal delay={70}>
            <div className="card" style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 4 }}>Where your bills stand</h2>
              <p className="settings-desc">Every tracked bill, plotted along its legislative journey.</p>
              <div className="portfolio-scatter">
                <div className="portfolio-scatter-line" />
                <div className="portfolio-scatter-stages">
                  {STAGE_ORDER.map((stage) => (
                    <div key={stage} className="portfolio-scatter-stage">
                      <div className="portfolio-scatter-dots">
                        {(stageBills[stage] ?? []).map((b) => (
                          <a key={b.id} href={`/bill/${b.id}`} className="portfolio-dot" style={{ background: STAGE_COLORS[stage] }} title={b.title} />
                        ))}
                      </div>
                      <div className="portfolio-scatter-label">{STAGE_LABELS[stage]}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="stats-bento">
              <div className="stats-bento-cell stats-bento-donut">
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 12 }}>Bills by stage</h2>
                <DonutChart data={donutData} />
              </div>
              <div className="stats-bento-cell stats-bento-position">
                <PositionBreakdown counts={positionCounts} />
              </div>
              {(partyCounts.D > 0 || partyCounts.R > 0 || partyCounts.I > 0) && (
                <div className="stats-bento-cell stats-bento-party">
                  <PartyBreakdownChart counts={partyCounts} title="Sponsors by party" />
                </div>
              )}
              {(chamberCounts.House > 0 || chamberCounts.Senate > 0) && (
                <div className="stats-bento-cell stats-bento-chamber">
                  <SimpleBarChart
                    data={[{ label: "House", value: chamberCounts.House }, { label: "Senate", value: chamberCounts.Senate }]}
                    title="Bills by chamber"
                    color="var(--party-ind)"
                  />
                </div>
              )}
            </div>
          </Reveal>

          {policyAreaData.length > 0 && (
            <Reveal delay={130}>
              <div className="card" style={{ marginTop: 16 }}>
                <SimpleBarChart data={policyAreaData} title="Top policy areas" color="var(--pos-watching)" />
              </div>
            </Reveal>
          )}
        </>
      )}
    </div>
  );
}

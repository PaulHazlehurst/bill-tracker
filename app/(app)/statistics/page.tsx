"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import CountUp from "@/components/CountUp";
import SimpleBarChart from "@/components/SimpleBarChart";
import PositionBreakdown from "@/components/PositionBreakdown";
import PartyBreakdownChart from "@/components/PartyBreakdownChart";
import Reveal from "@/components/Reveal";
import { STAGE_LABELS, extractMeta } from "@/lib/billMeta";
import { BarChart3 } from "lucide-react";

type Row = {
  bill_id: string;
  position: string;
  bills: { status_stage: string; raw_snapshot: any; congress: number; bill_type: string } | { status_stage: string; raw_snapshot: any; congress: number; bill_type: string }[] | null;
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

    // RLS already returns "your own rows, plus your team's if you're on
    // one" (see schema.sql) - "yours" just adds a client-side filter on
    // top of what RLS already permitted; "team" uses everything RLS gives back.
    let query = supabase
      .from("tracked_bills")
      .select("bill_id, position, bills(status_stage, raw_snapshot, congress, bill_type)");
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
  let enactedCount = 0;
  let totalCosponsors = 0;
  let billsWithCosponsorData = 0;

  // De-duplicate by bill_id first - on team scope, the same bill tracked
  // by three people should count once toward stage/party/chamber
  // distribution, not three times. Position counts are the one exception
  // (kept per-tracker below), since "who stands where" is genuinely a
  // per-person thing.
  const byBill = new Map<string, Row>();
  for (const r of rows) {
    positionCounts[r.position] = (positionCounts[r.position] ?? 0) + 1;
    if (!byBill.has(r.bill_id)) byBill.set(r.bill_id, r);
  }

  for (const r of byBill.values()) {
    const bill = Array.isArray(r.bills) ? r.bills[0] : r.bills;
    if (!bill) continue;

    stageCounts[bill.status_stage] = (stageCounts[bill.status_stage] ?? 0) + 1;
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

  const stageData = Object.entries(stageCounts).map(([stage, count]) => ({
    label: STAGE_LABELS[stage] ?? stage,
    value: count,
  }));
  const policyAreaData = Object.entries(policyAreaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
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
          <Reveal>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-value"><CountUp value={totalBills} /></div>
                <div className="stat-label">Bills tracked</div>
              </div>
              <div className="stat-card">
                <div className="stat-value"><CountUp value={enactedCount} /></div>
                <div className="stat-label">Enacted</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{successRate}%</div>
                <div className="stat-label">Reached law</div>
              </div>
              <div className="stat-card">
                <div className="stat-value"><CountUp value={avgCosponsors} /></div>
                <div className="stat-label">Avg. cosponsors</div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={60}>
            <div className="widget-grid" style={{ marginTop: 16 }}>
              <div className="card">
                <SimpleBarChart data={stageData} title="Bills by stage" />
              </div>
              <div className="card">
                <PositionBreakdown counts={positionCounts} />
              </div>
              {(partyCounts.D > 0 || partyCounts.R > 0 || partyCounts.I > 0) && (
                <div className="card">
                  <PartyBreakdownChart counts={partyCounts} title="Sponsors by party" />
                </div>
              )}
              {(chamberCounts.House > 0 || chamberCounts.Senate > 0) && (
                <div className="card">
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
            <Reveal delay={120}>
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

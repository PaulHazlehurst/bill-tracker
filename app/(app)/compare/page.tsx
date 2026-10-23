"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import PartyBreakdownChart from "@/components/PartyBreakdownChart";
import { STAGE_LABELS, extractMeta, citationFor, publicBillUrl, formatDate } from "@/lib/billMeta";
import RouteLine, { StagePill } from "@/components/ui/RouteLine";

type CompareBill = {
  id: string;
  title: string;
  status_stage: string;
  progress_pct: number;
  raw_snapshot: any;
  congress_url: string | null;
};

const POSITION_LABELS: Record<string, string> = { support: "Support", oppose: "Oppose", watching: "Watching", none: "No position" };

export default function ComparePage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bills, setBills] = useState<CompareBill[]>([]);
  const [positions, setPositions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const ids = (searchParams.get("ids") ?? "").split(",").filter(Boolean);
      if (ids.length < 2) {
        setError("Select at least 2 bills to compare from your dashboard.");
        setLoading(false);
        return;
      }

      const { data, error: billsError } = await supabase
        .from("bills")
        .select("id, title, status_stage, progress_pct, raw_snapshot, congress_url")
        .in("id", ids);

      if (billsError) {
        setError(billsError.message);
        setLoading(false);
        return;
      }

      // Preserve the order the person selected them in, not whatever order the DB returns.
      const ordered = ids.map((id) => (data ?? []).find((b) => b.id === id)).filter(Boolean) as CompareBill[];
      setBills(ordered);

      // RLS already scopes this to rows the person can see (their own or
      // their team's) - see schema.sql. A failure here just means
      // positions show as blank rather than breaking the page, since the
      // bill data itself (already loaded above) is the primary content.
      const { data: tracked, error: trackedError } = await supabase.from("tracked_bills").select("bill_id, position").in("bill_id", ids);
      if (trackedError) console.error("failed to load positions for comparison", trackedError);
      const posMap: Record<string, string> = {};
      for (const t of tracked ?? []) posMap[t.bill_id] = t.position;
      setPositions(posMap);

      setLoading(false);
    })();
  }, [searchParams]);

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <h1>Compare bills</h1>
          <p>Two to four bills side by side: where each stands, who sponsors it, and where you stand.</p>
        </div>
        <Link href="/dashboard" className="btn btn-ghost">Back to my bills</Link>
      </div>

      {loading ? (
        <Spinner label="Loading comparison…" />
      ) : error ? (
        // Landing here without at least two bill ids is the natural entry
        // point from the sidebar link - so this isn't an error, it's a
        // "here's how to use this feature" prompt with a clear next step.
        <div className="empty-cta">
          <h2 className="section-title" style={{ marginBottom: 8 }}>Pick bills to compare</h2>
          <p className="muted" style={{ margin: "0 0 16px" }}>
            On My bills, tick the boxes next to 2 to 4 bills and choose <strong>Compare</strong> in the bar that appears.
          </p>
          <Link href="/dashboard" className="btn btn-primary">Go to your bills</Link>
        </div>
      ) : (
        <div className="compare-grid">
          {bills.map((bill) => {
            const meta = extractMeta(bill.raw_snapshot);
            const party = (bill.raw_snapshot?.sponsors?.[0]?.party ?? "").toUpperCase();
            const partyLabel = party === "D" ? "Democrat" : party === "R" ? "Republican" : party ? "Independent/Other" : "Unknown";
            const position = positions[bill.id] ?? "none";

            return (
              <div key={bill.id} className="card compare-column">
                <div className="compare-top">
                  <span className="cite">{citationFor(bill.id)}</span>
                  <StagePill stage={bill.status_stage} />
                </div>
                <Link href={`/bill/${bill.id}`} className="compare-title">{bill.title}</Link>
                <div className="compare-route"><RouteLine stage={bill.status_stage} billType={bill.id.split("-")[0]} /></div>

                <dl className="compare-rows">
                  <div className="compare-row"><dt>Your position</dt><dd><span className={`pos-tag pos-${position}`}>{POSITION_LABELS[position]}</span></dd></div>
                  <div className="compare-row"><dt>Sponsor</dt><dd>{meta?.sponsorName ?? partyLabel}</dd></div>
                  {meta?.introducedDate && <div className="compare-row"><dt>Introduced</dt><dd>{meta.introducedDate}</dd></div>}
                  {meta && typeof meta.cosponsorCount === "number" && <div className="compare-row"><dt>Cosponsors</dt><dd>{meta.cosponsorCount}</dd></div>}
                  {meta?.policyArea && <div className="compare-row"><dt>Policy area</dt><dd>{meta.policyArea}</dd></div>}
                  {bill.raw_snapshot?.latestAction?.text && (
                    <div className="compare-row compare-row-stack"><dt>Latest action{bill.raw_snapshot.latestAction.actionDate ? `, ${formatDate(bill.raw_snapshot.latestAction.actionDate)}` : ""}</dt><dd>{bill.raw_snapshot.latestAction.text}</dd></div>
                  )}
                  {meta && meta.cboCostEstimates.length > 0 && <div className="compare-row"><dt>CBO estimate</dt><dd>Published</dd></div>}
                </dl>

                <a href={publicBillUrl(bill.id)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm compare-link">View on congress.gov</a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import PartyBreakdownChart from "@/components/PartyBreakdownChart";
import { STAGE_LABELS, extractMeta } from "@/lib/billMeta";

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
          <span className="page-eyebrow">Side by side</span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Compare bills</h1>
          <p className="muted" style={{ marginTop: 4 }}>Side by side, at a glance.</p>
        </div>
        <Link href="/dashboard"><button className="ghost">← Back to your bills</button></Link>
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
            Open your dashboard, tick 2–4 bills, and choose <strong style={{ color: "var(--text)" }}>Compare selected</strong>. This page then shows them side by side — sponsor, stage, cosponsors, your team's positions.
          </p>
          <Link href="/dashboard"><button className="primary">Go to your bills →</button></Link>
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
                <Link href={`/bill/${bill.id}`} className="compare-title">{bill.title}</Link>

                <div className="compare-row">
                  <span className="muted">Stage</span>
                  <span className={`pill pill-${bill.status_stage}`}>{STAGE_LABELS[bill.status_stage] ?? bill.status_stage}</span>
                </div>
                <div className="progress-track" style={{ margin: "6px 0 10px" }}>
                  <div className="progress-fill" style={{ width: `${bill.progress_pct}%` }} />
                </div>

                <div className="compare-row">
                  <span className="muted">Your position</span>
                  <span className={`position-select position-${position}`} style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: '0.75rem', cursor: "default" }}>
                    {POSITION_LABELS[position]}
                  </span>
                </div>
                <div className="compare-row">
                  <span className="muted">Sponsor party</span>
                  <span>{partyLabel}</span>
                </div>
                {meta && typeof meta.cosponsorCount === "number" && (
                  <div className="compare-row">
                    <span className="muted">Cosponsors</span>
                    <span>{meta.cosponsorCount}</span>
                  </div>
                )}
                {meta?.policyArea && (
                  <div className="compare-row">
                    <span className="muted">Policy area</span>
                    <span>{meta.policyArea}</span>
                  </div>
                )}

                {bill.congress_url && (
                  <a href={bill.congress_url} target="_blank" rel="noreferrer" className="external-link-btn" style={{ marginTop: 12 }}>
                    View on congress.gov
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

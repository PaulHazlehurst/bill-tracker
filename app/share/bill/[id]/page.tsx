"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { STAGE_LABELS, formatDate, parseVoteInfo } from "@/lib/billMeta";
import ExpandableText from "@/components/ExpandableText";
import { Check, Landmark } from "lucide-react";

const STAGE_ORDER = ["introduced", "committee", "passed_house", "passed_senate", "to_president", "enacted"];

type PublicBill = {
  id: string;
  title: string;
  bill_type: string;
  bill_number: number;
  congress: number;
  status_stage: string;
  progress_pct: number;
  latest_action: string | null;
  latest_action_date: string | null;
  congress_url: string | null;
  raw_snapshot: any;
  summaries: { text: string; actionDesc: string }[] | null;
};

// A genuinely public page - no login, no sidebar, no session check. Built
// for sending a bill's profile to someone outside the app (a colleague,
// a reporter, a stakeholder). Reads only from /api/public/bill/[id],
// which itself only ever touches the `bills` table (public congress.gov
// data) - never tracked_bills, which is private.
export default function PublicBillSharePage() {
  const params = useParams();
  const billId = params.id as string;
  const [bill, setBill] = useState<PublicBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/bill/${billId}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((body) => setBill(body.bill))
      .catch(() => setError("This bill couldn't be found."))
      .finally(() => setLoading(false));
  }, [billId]);

  const stageIndex = bill ? STAGE_ORDER.indexOf(bill.status_stage) : -1;
  const vote = bill?.latest_action ? parseVoteInfo(bill.latest_action) : null;
  const sponsor = bill?.raw_snapshot?.sponsors?.[0];

  return (
    <div>
      <nav className="nav">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>Bill Tracker</Link>
        <div className="nav-right">
          <Link href="/signup"><button className="primary">Track bills like this</button></Link>
        </div>
      </nav>

      <div className="container" style={{ maxWidth: 640, paddingTop: 40 }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : error || !bill ? (
          <p className="error-text">{error}</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: '0.8125rem', marginBottom: 4 }}>
              Shared bill profile · {bill.bill_type.toUpperCase()} {bill.bill_number} · {bill.congress}th Congress
            </p>
            <h1 style={{ fontSize: '1.625rem', fontWeight: 500, lineHeight: 1.3, marginBottom: 16 }}>{bill.title}</h1>

            <div className="card">
              <div className="journey-track">
                <div className="journey-line">
                  <div
                    className="journey-line-fill"
                    style={{ width: `${(Math.max(stageIndex, 0) / (STAGE_ORDER.length - 1)) * 100}%` }}
                  />
                </div>
                <div className="journey-steps">
                  {STAGE_ORDER.map((s, i) => {
                    const done = i < stageIndex;
                    const current = i === stageIndex;
                    return (
                      <div key={s} className="journey-step">
                        <div className={`journey-circle ${done ? "journey-done" : current ? "journey-current" : "journey-future"}`}>
                          {done ? <Check size={12} /> : i + 1}
                        </div>
                        <div className={`journey-label ${i <= stageIndex ? "journey-label-active" : ""}`}>{STAGE_LABELS[s]}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {bill.latest_action && (
              <div className="card">
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 4 }}>Latest action</h2>
                <p style={{ fontSize: '0.875rem' }}>{bill.latest_action}</p>
                {bill.latest_action_date && <p className="muted" style={{ fontSize: '0.75rem' }}>{formatDate(bill.latest_action_date)}</p>}
                {vote && (
                  <div className="vote-badge" style={{ marginTop: 8 }}>
                    <span className="yea">{vote.yea} Yea</span><span>·</span><span className="nay">{vote.nay} Nay</span>
                  </div>
                )}
              </div>
            )}

            {bill.summaries?.[0]?.text && (
              <div className="card">
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 4 }}>Summary</h2>
                <p className="settings-desc">{bill.summaries[0].actionDesc} · official, from the Congressional Research Service</p>
                <ExpandableText text={bill.summaries[0].text} className="official-text" />
              </div>
            )}

            {sponsor?.fullName && (
              <div className="card">
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 4 }}>Sponsor</h2>
                <p style={{ fontSize: '0.875rem' }}>{sponsor.fullName}{sponsor.party ? ` (${sponsor.party}-${sponsor.state ?? ""})` : ""}</p>
              </div>
            )}

            {bill.congress_url && (
              <a href={bill.congress_url} target="_blank" rel="noreferrer" className="external-link-btn">
                View full text on congress.gov
              </a>
            )}

            <div className="card" style={{ marginTop: 24, textAlign: "center" }}>
              <Landmark size={20} style={{ color: "var(--accent)", marginBottom: 8 }} />
              <p className="muted" style={{ fontSize: '0.8125rem', margin: 0 }}>
                Want to track this bill yourself, get notified of changes, and see votes, hearings, and lobbying activity?
              </p>
              <Link href="/signup"><button className="primary" style={{ marginTop: 10 }}>Sign up free</button></Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

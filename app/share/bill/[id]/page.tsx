"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatDate, parseVoteInfo, citationFor, publicBillUrl, explainAction } from "@/lib/billMeta";
import RouteLine, { StagePill } from "@/components/ui/RouteLine";
import { BrandMark } from "@/components/Sidebar";
import ExpandableText from "@/components/ExpandableText";


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

  const vote = bill?.latest_action ? parseVoteInfo(bill.latest_action) : null;
  const sponsor = bill?.raw_snapshot?.sponsors?.[0];
  const plain = bill ? explainAction(bill.latest_action, bill.bill_type) : null;

  return (
    <div className="share">
      <nav className="lnav">
        <Link href="/" className="auth-brand"><BrandMark size={28} /><span>Bill Tracker</span></Link>
        <Link href="/signup" className="btn btn-primary">Track bills like this</Link>
      </nav>

      <main className="page share-page">
        {loading ? (
          <div className="skel skel-title" />
        ) : error || !bill ? (
          <div className="empty"><p className="empty-title">This bill couldn't be found</p><p className="empty-body">The link may be incomplete.</p></div>
        ) : (
          <>
            <div className="bill-hero-meta">
              <span className="cite cite-lg">{citationFor(bill.bill_type, bill.bill_number)}</span>
              <StagePill stage={bill.status_stage} />
              <span className="meta-item">{bill.congress}th Congress</span>
            </div>
            <h1 className="bill-title">{bill.title}</h1>
            {sponsor?.fullName && <p className="bill-sponsor">Sponsored by <strong>{sponsor.fullName}</strong></p>}

            <section className="journey" style={{ marginTop: 24 }}>
              <RouteLine stage={bill.status_stage} billType={bill.bill_type} size="lg" animate />
            </section>

            {bill.latest_action && (
              <section className="latest">
                <div className="latest-head">
                  <h2 className="latest-label">Latest action</h2>
                  {bill.latest_action_date && <time className="latest-date">{formatDate(bill.latest_action_date)}</time>}
                </div>
                <p className="latest-text">{bill.latest_action}</p>
                {vote && <p className="vote"><span className="vote-yea">{vote.yea} yea</span><span className="vote-nay">{vote.nay} nay</span></p>}
                {plain && <p className="explain"><span><strong>What this means:</strong> {plain}</span></p>}
              </section>
            )}

            {bill.summaries?.[0]?.text && (
              <section className="card summary">
                <div className="card-head">
                  <h2 className="card-title">What the bill does</h2>
                  <span className="source-tag">Official CRS summary</span>
                </div>
                <p className="card-sub">{bill.summaries[0].actionDesc}</p>
                <ExpandableText text={bill.summaries[0].text} className="official-text" limit={900} />
              </section>
            )}

            <a href={publicBillUrl(bill.id)} target="_blank" rel="noreferrer" className="btn btn-secondary">Read the full bill on congress.gov</a>

            <section className="share-cta">
              <h2>Follow bills like this one</h2>
              <p>Bill Tracker checks congress.gov every morning and tells you, in plain English, when the bills you care about move.</p>
              <Link href="/signup" className="btn btn-primary">Create a free account</Link>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

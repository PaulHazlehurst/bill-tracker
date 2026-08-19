"use client";

import { useState } from "react";
import { Sparkles, TrendingUp, Users2, Mail, Search, ArrowRight, Check } from "lucide-react";

const SUGGESTED_BILLS = [
  {
    congress: 119, billType: "hr", billNumber: 1,
    title: "One Big Beautiful Bill Act",
    blurb: "The 119th Congress's major reconciliation package - signed into law. Full lifecycle: hearings, three recorded votes, heavy lobbying activity.",
  },
  {
    congress: 119, billType: "hr", billNumber: 18,
    title: "Bipartisan Background Checks Act",
    blurb: "210 cosponsors and counting. A good look at real bipartisan cosponsor spread and sustained lobbying interest.",
  },
];

// The first thing a brand-new account sees, before they've tracked
// anything. Two jobs at once: make it obvious what to do (one-click track
// a real, well-known bill), and actually demonstrate the product's depth
// immediately rather than a blank page and a search box.
export default function FirstRunHero({ onTracked }: { onTracked: () => void }) {
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set());

  async function quickTrack(bill: typeof SUGGESTED_BILLS[number]) {
    const key = `${bill.billType}-${bill.billNumber}-${bill.congress}`;
    setTrackingId(key);
    try {
      const res = await fetch("/api/bills/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ congress: bill.congress, billType: bill.billType, billNumber: bill.billNumber }),
      });
      if (res.ok) {
        setTrackedIds((prev) => new Set(prev).add(key));
        onTracked();
      }
    } finally {
      setTrackingId(null);
    }
  }

  return (
    <div className="first-run-hero">
      <div className="first-run-intro">
        <div className="first-run-badge"><Sparkles size={13} /> Welcome</div>
        <h1 className="first-run-headline">Let's find your first bill.</h1>
        <p className="first-run-sub">
          Track a bill, take a position on it, and get notified the moment it changes -
          with real vote records, hearing history, and lobbying activity pulled in automatically.
        </p>
      </div>

      <div className="first-run-suggestions">
        <p className="first-run-suggestions-label"><TrendingUp size={13} /> Popular bills to try right now</p>
        <div className="first-run-cards">
          {SUGGESTED_BILLS.map((bill) => {
            const key = `${bill.billType}-${bill.billNumber}-${bill.congress}`;
            const isTracked = trackedIds.has(key);
            return (
              <div key={key} className="first-run-card">
                <div className="first-run-card-tag">{bill.billType.toUpperCase()} {bill.billNumber} · {bill.congress}th Congress</div>
                <h3 className="first-run-card-title">{bill.title}</h3>
                <p className="first-run-card-blurb">{bill.blurb}</p>
                <button
                  className={isTracked ? "ghost" : "primary"}
                  onClick={() => quickTrack(bill)}
                  disabled={trackingId === key || isTracked}
                >
                  {isTracked ? <><Check size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Tracking it</> :
                    trackingId === key ? "Tracking…" : <>Track this bill <ArrowRight size={14} style={{ marginLeft: 4, verticalAlign: -2 }} /></>}
                </button>
              </div>
            );
          })}
        </div>
        <p className="first-run-or">
          <Search size={13} /> Or search for something specific below ↓
        </p>
      </div>

      <div className="first-run-features">
        <div className="first-run-feature"><Mail size={14} /> Email alerts when a tracked bill changes</div>
        <div className="first-run-feature"><Users2 size={14} /> Shared visibility if you're on a team</div>
        <div className="first-run-feature"><TrendingUp size={14} /> Votes, hearings, and lobbying activity in one place</div>
      </div>
    </div>
  );
}

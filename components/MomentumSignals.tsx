"use client";

// Deliberately NOT a predictive score. There's no real model behind a
// number like "73% likely to pass," and presenting one would look more
// authoritative than it is. This instead surfaces the actual, verifiable
// signals a real analyst would look at, and lets the reader draw their own
// conclusion - all computed from data already on the page, no extra fetch.

import { daysSince } from "@/lib/billMeta";

export default function MomentumSignals({
  introducedDate,
  latestActionDate,
  cosponsorBreakdown,
  cosponsorEventCount,
}: {
  introducedDate: string | null | undefined;
  latestActionDate: string | null | undefined;
  cosponsorBreakdown: { D: number; R: number } | null;
  cosponsorEventCount: number;
}) {
  const daysIntroduced = daysSince(introducedDate);
  const daysSinceAction = daysSince(latestActionDate);
  const bipartisan = cosponsorBreakdown ? cosponsorBreakdown.D > 0 && cosponsorBreakdown.R > 0 : null;

  const signals = [
    {
      label: "Bipartisan cosponsors",
      value: bipartisan === null ? "—" : bipartisan ? "Yes" : "No",
      hint: bipartisan === null ? "Load cosponsor data to see this" : bipartisan ? "Has cosponsors from both parties" : "All cosponsors are from one party",
      tone: bipartisan === true ? "support" : bipartisan === false ? "watching" : "none",
    },
    {
      label: "Days since introduced",
      value: daysIntroduced === null ? "—" : String(daysIntroduced),
      hint: null,
      tone: "none" as const,
    },
    {
      label: "Days since last action",
      value: daysSinceAction === null ? "—" : String(daysSinceAction),
      hint: daysSinceAction !== null && daysSinceAction > 90 ? "No recent movement" : daysSinceAction !== null && daysSinceAction < 14 ? "Recently active" : null,
      tone: daysSinceAction !== null && daysSinceAction > 90 ? "oppose" : daysSinceAction !== null && daysSinceAction < 14 ? "support" : "none",
    },
    {
      label: "Cosponsor changes recorded",
      value: String(cosponsorEventCount),
      hint: cosponsorEventCount > 0 ? "Since we started tracking this bill" : null,
      tone: "none" as const,
    },
  ];

  return (
    <div>
      <h2 className="card-title">Momentum</h2>
      <p className="card-sub">Verifiable facts, not a prediction. Nobody can honestly say whether a bill will pass.</p>
      <div className="signal-grid">
        {signals.map((s) => (
          <div key={s.label} className={`signal-chip signal-${s.tone}`}>
            <div className="signal-value">{s.value}</div>
            <div className="signal-label">{s.label}</div>
            {s.hint && <div className="signal-hint">{s.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

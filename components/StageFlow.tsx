"use client";

// A single segmented ribbon showing the proportion of tracked bills at
// each legislative stage - replaces a grid of separate boxes with one
// elegant visual that shows relative proportion at a glance, using the
// same stage colors as the pill component and the statistics donut, so
// this reads as the same story everywhere in the app.
// Colors come from CSS tokens (see "Legislative stage colors" in
// globals.css) so they adapt to dark mode and stay in sync with the
// Statistics charts, instead of being hardcoded hex in two separate files.
const SEGMENTS = [
  { key: "active", label: "Introduced", color: "var(--stage-introduced)" },
  { key: "committee", label: "In committee", color: "var(--stage-committee)" },
  { key: "passed", label: "Passed a chamber", color: "var(--stage-passed)" },
  { key: "enacted", label: "Enacted", color: "var(--stage-enacted)" },
];

export default function StageFlow({ counts }: { counts: Record<string, number> }) {
  const total = SEGMENTS.reduce((sum, s) => sum + (counts[s.key] ?? 0), 0);
  if (total === 0) return null;

  return (
    <div className="stage-flow">
      <div className="stage-flow-ribbon">
        {SEGMENTS.map((s) => {
          const value = counts[s.key] ?? 0;
          if (value === 0) return null;
          return (
            <div
              key={s.key}
              className="stage-flow-segment"
              style={{ width: `${(value / total) * 100}%`, background: s.color }}
              title={`${s.label}: ${value}`}
            />
          );
        })}
      </div>
      <div className="stage-flow-legend">
        {SEGMENTS.map((s) => {
          const value = counts[s.key] ?? 0;
          if (value === 0) return null;
          return (
            <div key={s.key} className="stage-flow-legend-item">
              <span className="stage-flow-dot" style={{ background: s.color }} />
              <span>{s.label}</span>
              <span className="stage-flow-count">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

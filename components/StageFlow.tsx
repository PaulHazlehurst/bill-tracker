"use client";

// A single segmented ribbon showing the proportion of tracked bills at
// each legislative stage - replaces a grid of separate boxes with one
// elegant visual that shows relative proportion at a glance, using the
// same stage colors as the pill component and the statistics donut, so
// this reads as the same story everywhere in the app.
const SEGMENTS = [
  { key: "active", label: "Introduced", color: "#4a5769" },
  { key: "committee", label: "In committee", color: "#8a5a1a" },
  { key: "passed", label: "Passed a chamber", color: "#1d6d3b" },
  { key: "enacted", label: "Enacted", color: "#15803d" },
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

"use client";

const SEGMENTS = [
  { key: "support", label: "Support", color: "var(--pos-support)" },
  { key: "oppose", label: "Oppose", color: "var(--pos-oppose)" },
  { key: "watching", label: "Watching", color: "var(--pos-watching)" },
  { key: "none", label: "No position", color: "var(--pos-none)" },
] as const;

// Just renders counts the parent page already computed from data it already
// loaded (tracked_bills.position) - no fetch of its own, no extra cost.
export default function PositionBreakdown({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div className="card">
      <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 10 }}>Where you stand</h2>
      <div className="position-bar">
        {SEGMENTS.map((s) => {
          const count = counts[s.key] ?? 0;
          if (count === 0) return null;
          return <div key={s.key} style={{ width: `${(count / total) * 100}%`, background: s.color }} title={`${s.label}: ${count}`} />;
        })}
      </div>
      <div className="position-legend">
        {SEGMENTS.map((s) => (
          <span key={s.key}>
            <span className="position-legend-dot" style={{ background: s.color }} />
            {s.label} <strong>{counts[s.key] ?? 0}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

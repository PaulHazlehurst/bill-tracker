"use client";

// A reusable horizontal bar chart - hand-built with plain divs, matching
// every other chart in this app (PositionBreakdown, PartyBreakdownChart).
// Deliberately not a charting library: keeps the bundle light and the
// visual language consistent across the whole product.
export default function SimpleBarChart({
  data,
  title,
  color = "var(--accent)",
}: {
  data: { label: string; value: number }[];
  title?: string;
  color?: string;
}) {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((d) => d.value), 1);

  if (sorted.length === 0) return null;

  return (
    <div>
      {title && <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 10 }}>{title}</h2>}
      <div>
        {sorted.map((d) => (
          <div key={d.label} className="simple-bar-row">
            <span className="simple-bar-label">{d.label}</span>
            <div className="simple-bar-track">
              <div className="simple-bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
            </div>
            <span className="simple-bar-value">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

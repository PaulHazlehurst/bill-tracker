"use client";

const PARTIES = [
  { key: "D", label: "Democrat", color: "var(--party-dem)" },
  { key: "R", label: "Republican", color: "var(--party-rep)" },
  { key: "I", label: "Independent/Other", color: "var(--party-ind)" },
] as const;

// Reuses the same bar+legend visual pattern as PositionBreakdown - just
// with party colors instead of position colors. Purely presentational;
// the parent supplies the counts (either from a cached on-demand fetch for
// a single bill's cosponsors, or aggregated client-side across a whole
// tracked-bills list at zero extra cost).
export default function PartyBreakdownChart({
  counts,
  title = "By party",
  capped,
}: {
  counts: Record<string, number>;
  title?: string;
  capped?: boolean;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div>
      <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: 10 }}>{title}</h2>
      <div className="position-bar">
        {PARTIES.map((p) => {
          const count = counts[p.key] ?? 0;
          if (count === 0) return null;
          return <div key={p.key} style={{ width: `${(count / total) * 100}%`, background: p.color }} title={`${p.label}: ${count}`} />;
        })}
      </div>
      <div className="position-legend">
        {PARTIES.map((p) => (
          (counts[p.key] ?? 0) > 0 && (
            <span key={p.key}>
              <span className="position-legend-dot" style={{ background: p.color }} />
              {p.label} <strong>{counts[p.key]}</strong>
            </span>
          )
        ))}
      </div>
      {capped && (
        <p className="muted" style={{ fontSize: '0.6875rem', marginTop: 6 }}>
          Based on the first 250 cosponsors - this bill has more than that.
        </p>
      )}
    </div>
  );
}

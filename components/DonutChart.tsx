"use client";

// A real SVG donut chart, built from stroke-dasharray segments - no
// charting library needed. Colors are passed in explicitly so callers can
// reuse the exact same stage-color language as the pill component
// elsewhere in the app ("recognize a color, know what it means").
export default function DonutChart({
  data,
  size = 160,
  strokeWidth = 22,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  strokeWidth?: number;
}) {
  const filtered = data.filter((d) => d.value > 0);
  const total = filtered.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offsetSoFar = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-soft)" strokeWidth={strokeWidth} />
        {filtered.map((d, i) => {
          const fraction = d.value / total;
          const dash = fraction * circumference;
          const gap = circumference - dash;
          const el = (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={radius}
              fill="none"
              stroke={d.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offsetSoFar}
              strokeLinecap={filtered.length > 1 ? "butt" : "round"}
              style={{ transition: "stroke-dasharray 0.6s ease" }}
            />
          );
          offsetSoFar += dash;
          return el;
        })}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: '0.8125rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
            <span style={{ color: "var(--text-soft)" }}>{d.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", marginLeft: "auto", paddingLeft: 8 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

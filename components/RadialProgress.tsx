"use client";

// A circular progress ring for percentages - genuinely the right visual
// metaphor for "X% of something," unlike a flat bar which reads more as
// "loading" than "achievement." Built from a single SVG stroke, no library.
export default function RadialProgress({
  percent,
  size = 88,
  strokeWidth = 8,
  color = "var(--accent)",
  label,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dash = (clamped / 100) * circumference;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-soft)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.7s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-display), Georgia, serif", fontWeight: 500,
        fontSize: size > 70 ? "1.375rem" : "1rem", color: "var(--text)",
      }}>
        {Math.round(clamped)}%
      </div>
      {label && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, textAlign: "center", marginTop: 6, fontSize: '0.6875rem', color: "var(--text-soft)" }}>
          {label}
        </div>
      )}
    </div>
  );
}

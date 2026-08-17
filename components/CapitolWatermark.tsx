"use client";

// A low-opacity background watermark, built as an original SVG silhouette
// rather than a photograph - avoids any copyright question entirely, adds
// zero image weight to the page, and adapts to whichever theme is active
// since it's drawn with currentColor. Purely decorative: aria-hidden,
// pointer-events disabled, fixed behind all real content.
export default function CapitolWatermark() {
  return (
    <div className="capitol-watermark" aria-hidden="true">
      <svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
        {/* Steps */}
        <rect x="40" y="255" width="320" height="10" />
        <rect x="55" y="245" width="290" height="10" />
        <rect x="70" y="235" width="260" height="10" />
        {/* Base wings */}
        <rect x="80" y="150" width="90" height="85" />
        <rect x="230" y="150" width="90" height="85" />
        {/* Central facade */}
        <rect x="170" y="130" width="60" height="105" />
        {/* Pediment */}
        <polygon points="165,130 200,95 235,130" />
        {/* Columns */}
        <rect x="90" y="160" width="8" height="75" />
        <rect x="112" y="160" width="8" height="75" />
        <rect x="134" y="160" width="8" height="75" />
        <rect x="152" y="160" width="8" height="75" />
        <rect x="240" y="160" width="8" height="75" />
        <rect x="258" y="160" width="8" height="75" />
        <rect x="280" y="160" width="8" height="75" />
        <rect x="302" y="160" width="8" height="75" />
        {/* Dome drum */}
        <rect x="180" y="95" width="40" height="40" />
        {/* Dome */}
        <path d="M 172 100 A 28 40 0 0 1 228 100 Z" />
        {/* Lantern + statue */}
        <rect x="196" y="60" width="8" height="20" />
        <circle cx="200" cy="52" r="6" />
      </svg>
    </div>
  );
}

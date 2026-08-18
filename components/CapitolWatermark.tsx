"use client";

// A low-opacity background watermark, built as an original SVG silhouette
// rather than a photograph - avoids any copyright question entirely (see
// the conversation with the person about why a stock image wasn't used
// here), adds zero image weight to the page, and adapts to whichever theme
// is active since it's drawn with currentColor. Purely decorative:
// aria-hidden, pointer-events disabled, fixed behind all real content.
export default function CapitolWatermark() {
  return (
    <div className="capitol-watermark" aria-hidden="true">
      <svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
        {/* Steps */}
        <rect x="30" y="258" width="340" height="8" />
        <rect x="45" y="248" width="310" height="8" />
        <rect x="60" y="238" width="280" height="8" />
        <rect x="75" y="228" width="250" height="8" />

        {/* Base wings */}
        <rect x="75" y="140" width="95" height="90" />
        <rect x="230" y="140" width="95" height="90" />
        {/* Wing cornice */}
        <rect x="72" y="134" width="101" height="6" />
        <rect x="227" y="134" width="101" height="6" />
        {/* Wing columns */}
        <rect x="86" y="152" width="7" height="72" /><rect x="106" y="152" width="7" height="72" />
        <rect x="126" y="152" width="7" height="72" /><rect x="146" y="152" width="7" height="72" />
        <rect x="238" y="152" width="7" height="72" /><rect x="258" y="152" width="7" height="72" />
        <rect x="278" y="152" width="7" height="72" /><rect x="298" y="152" width="7" height="72" />

        {/* Central facade block */}
        <rect x="165" y="122" width="70" height="108" />
        {/* Pediment */}
        <polygon points="158,122 200,84 242,122" />
        {/* Central portico columns */}
        <rect x="176" y="155" width="7" height="70" /><rect x="192" y="155" width="7" height="70" />
        <rect x="208" y="155" width="7" height="70" /><rect x="224" y="155" width="7" height="70" />
        {/* Central cornice */}
        <rect x="163" y="150" width="74" height="6" />

        {/* Drum beneath the dome, with a ring of colonnettes suggested by
            evenly spaced thin rects - the peristyle that wraps the real
            Capitol dome's base. */}
        <rect x="172" y="88" width="56" height="36" />
        <rect x="177" y="94" width="4" height="26" /><rect x="187" y="94" width="4" height="26" />
        <rect x="197" y="94" width="4" height="26" /><rect x="209" y="94" width="4" height="26" />
        <rect x="219" y="94" width="4" height="26" />

        {/* Dome, built from a real bezier curve rather than a simple arc -
            gives the characteristic Capitol ogee profile instead of a flat
            hemisphere. */}
        <path d="M 168 90 C 168 55 178 30 200 22 C 222 30 232 55 232 90 Z" />
        {/* Ribbing suggestion - thin gaps reading as the dome's structural ribs */}
        <path d="M 200 22 L 200 90 M 184 26 L 178 88 M 216 26 L 222 88" stroke="var(--bg)" strokeWidth="1.4" fill="none" />

        {/* Lantern and statue (Statue of Freedom, simplified) */}
        <rect x="194" y="12" width="12" height="12" />
        <rect x="197" y="2" width="6" height="12" />
        <circle cx="200" cy="0" r="3" />
      </svg>
    </div>
  );
}

"use client";

// A low-opacity background watermark. Uses an actual uploaded image
// (public/capitol-bg.png) rather than the earlier hand-drawn SVG version -
// per the person's explicit statement that this specific image doesn't
// require a license, which is the thing I'd flagged as unresolved before.
// I'm relying on that representation since I can't independently verify an
// image's licensing status myself. Rendered in grayscale at low opacity via
// CSS (not baked into the file), so the treatment stays easy to adjust
// later without needing to re-process the image itself.
export default function CapitolWatermark() {
  return (
    <div className="capitol-watermark" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/capitol-bg.png" alt="" />
    </div>
  );
}

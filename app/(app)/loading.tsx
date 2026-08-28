// Route-level loading UI. Next.js shows this INSTANTLY when you navigate to
// any page in the signed-in app, before that page's code and data arrive.
//
// This is the "appearance is what matters" fix: combined with next/link
// (which keeps navigation client-side instead of reloading the whole
// document), a click now paints a structured skeleton immediately rather
// than leaving the last page frozen while the new one loads. The perceived
// wait effectively disappears even though the underlying data takes the
// same time to arrive.
export default function AppLoading() {
  return (
    <div className="container-wide" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="pageskel">
        <div className="pageskel-eyebrow shimmer" />
        <div className="pageskel-title shimmer" />
        <div className="pageskel-sub shimmer" />
        <div className="pageskel-card shimmer" />
        <div className="pageskel-row shimmer" />
        <div className="pageskel-row shimmer" />
        <div className="pageskel-row shimmer" />
        <div className="pageskel-row shimmer" />
      </div>
    </div>
  );
}

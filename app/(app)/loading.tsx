// Route-level loading UI, painted instantly on navigation while the page's
// code and data arrive.
export default function AppLoading() {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="skel skel-title" />
      <div className="skel skel-line" />
      <div className="skel skel-block" />
      <div className="skel skel-row" />
      <div className="skel skel-row" />
      <div className="skel skel-row" />
    </div>
  );
}

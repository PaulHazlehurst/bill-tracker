export default function Spinner({ label, large }: { label?: string; large?: boolean }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className={`spinner${large ? " large" : ""}`} aria-hidden="true" />
      <span>{label ?? "Loading…"}</span>
    </div>
  );
}

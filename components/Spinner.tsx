export default function Spinner({ label, large }: { label?: string; large?: boolean }) {
  return (
    <div className={`loading${large ? " loading-large" : ""}`} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? "Loading…"}</span>
    </div>
  );
}

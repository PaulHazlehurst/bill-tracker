import { LucideIcon } from "lucide-react";

// A single deliberate icon plus a line of text - not meant to be busy,
// just enough visual anchor that an empty list doesn't read as a blank/broken
// page. Used on the dashboard, team, and activity pages.
export default function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <Icon size={28} strokeWidth={1.5} style={{ color: "var(--text-soft)", opacity: 0.6, marginBottom: 10 }} />
      <p className="muted" style={{ margin: 0 }}>{children}</p>
    </div>
  );
}

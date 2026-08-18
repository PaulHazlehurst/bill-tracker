import { LucideIcon } from "lucide-react";

// A single deliberate icon plus a line of text - not meant to be busy,
// just enough visual anchor that an empty list doesn't read as a blank/broken
// page. Used on the dashboard, team, and activity pages.
export default function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon size={22} strokeWidth={1.5} />
      </div>
      <p className="muted" style={{ margin: 0 }}>{children}</p>
    </div>
  );
}

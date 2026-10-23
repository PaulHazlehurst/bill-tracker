import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

// An empty screen is an invitation to act: an icon, a short line saying what
// would appear here, and (optionally) the action that gets it there.
export default function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={20} strokeWidth={1.75} /></div>
      {title && <p className="empty-title">{title}</p>}
      {children && <p className="empty-body">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

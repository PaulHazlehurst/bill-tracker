import { ReactNode } from "react";

// One consistent page heading for every signed-in page: a title, one plain
// sentence about what the page is for, and the page's actions on the right.
// Replaces ~13 slightly different hand-styled <h1>s.
export default function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
        {children}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

import Link from "next/link";
import { ReactNode } from "react";
import { BrandMark } from "@/components/Sidebar";
import RouteLine from "@/components/ui/RouteLine";

// Shared frame for log in, sign up and password screens: the form on one
// side, and on the other a small, real-looking moment from the product so a
// first-time visitor can see what it does.
export default function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-form-side">
        <Link href="/" className="auth-brand"><BrandMark size={28} /><span>Bill Tracker</span></Link>
        <div className="auth-form-wrap">
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-sub">{subtitle}</p>}
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
      </div>
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-art-inner">
          <p className="auth-art-kicker">Overnight on congress.gov</p>
          <div className="auth-card">
            <div className="auth-card-meta"><span className="cite">H.R. 2407</span><span className="stage-pill tone-chamber">Passed House</span></div>
            <p className="auth-card-title">Rural Hospital Closure Relief Act</p>
            <RouteLine stage="passed_house" billType="hr" size="lg" animate />
            <p className="auth-card-note"><strong>381 to 37.</strong> The full House approved it under a fast-track vote. Next it goes to the Senate.</p>
          </div>
          <div className="auth-card auth-card-small">
            <div className="auth-card-meta"><span className="cite">S. 1260</span><span className="stage-pill tone-committee">Reported by committee</span></div>
            <RouteLine stage="reported" billType="s" animate />
          </div>
          <p className="auth-art-caption">Every bill you follow, drawn as the route it takes through Congress, with each step explained in plain English.</p>
        </div>
      </aside>
    </div>
  );
}

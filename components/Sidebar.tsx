"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import {
  LayoutGrid, Activity, Scale, Landmark, GitBranch, Users, Contact, Settings, Gauge, X, CalendarDays, Briefcase, Pill,
} from "lucide-react";

// Grouped by what someone is trying to do. Every page is still reachable
// from search (Ctrl+K); the rail holds the ones people use week to week.
//  - Insights is one page: where bills are going, read against your position.
//  - Compare lives where it's used: select bills on My bills, then Compare.
//  - Briefing is a button on My bills (it's a printout of that list).
//  - Data sources is for whoever manages the app (team admins).
// "Clients" = organizations you represent; "Congress" = the official
// directory of members; "Contacts" = your own stakeholder list; "Team" =
// teammates with logins.
const NAV_GROUPS = [
  {
    label: "Follow",
    items: [
      { href: "/dashboard", label: "My bills", Icon: LayoutGrid },
      { href: "/activity", label: "Activity", Icon: Activity },
      { href: "/week", label: "Week ahead", Icon: CalendarDays },
      { href: "/regulations", label: "Regulations", Icon: Scale },
      { href: "/drug-boards", label: "Drug boards", Icon: Pill },
      { href: "/insights", label: "Insights", Icon: GitBranch },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/clients", label: "Clients", Icon: Briefcase },
      { href: "/legislators", label: "Congress", Icon: Landmark },
      { href: "/members", label: "Contacts", Icon: Contact },
      { href: "/team", label: "Team", Icon: Users },
    ],
  },
];

const UTILITY_ITEMS = [
  { href: "/settings", label: "Settings", Icon: Settings, adminOnly: false },
  { href: "/api-usage", label: "Data sources", Icon: Gauge, adminOnly: true },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname.startsWith("/bill/");
  if (href === "/legislators") return pathname.startsWith("/legislator");
  if (href === "/insights") return pathname === "/insights" || pathname === "/impact" || pathname === "/statistics";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();
  const { org, canManage } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The top bar's menu button opens the rail on small screens.
  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("bt:open-nav", open);
    return () => window.removeEventListener("bt:open-nav", open);
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <>
      {mobileOpen && <div className="rail-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`rail${mobileOpen ? " rail-open" : ""}`} aria-label="Main navigation">
        <div className="rail-brand">
          <Link href="/dashboard" className="rail-mark" aria-label="Bill Tracker home">
            <BrandMark />
            <span className="rail-name">Bill Tracker</span>
          </Link>
          <button className="icon-btn rail-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>

        {org?.name && (
          <div className="rail-org">
            {org.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt="" className="rail-org-logo" />
            ) : (
              <span className="rail-org-logo rail-org-initial">{org.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="rail-org-name">{org.name}</span>
          </div>
        )}

        <nav className="rail-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="rail-group">
              <div className="rail-group-label">{group.label}</div>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link key={item.href} href={item.href} prefetch className={`rail-link${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
                    <item.Icon size={17} strokeWidth={1.9} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="rail-foot">
          {UTILITY_ITEMS.filter((item) => !item.adminOnly || canManage).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} prefetch className={`rail-link${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
                <item.Icon size={17} strokeWidth={1.9} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </aside>
    </>
  );
}

// The mark: a short route line with three stations, the last one reached.
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
      <rect width="32" height="32" rx="9" className="brand-mark-bg" />
      <path d="M7 21 H16 L21 11 H25" className="brand-mark-line" />
      <circle cx="7" cy="21" r="2.6" className="brand-mark-dot" />
      <circle cx="16" cy="21" r="2.6" className="brand-mark-dot" />
      <circle cx="25" cy="11" r="3.4" className="brand-mark-end" />
    </svg>
  );
}

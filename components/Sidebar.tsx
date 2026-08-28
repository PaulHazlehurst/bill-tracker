"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/SessionProvider";
import { timeAgo } from "@/lib/billMeta";
import { useTicker } from "@/lib/useTicker";
import { FileText, Users, Activity, Settings, Menu, LogOut, Gauge, BarChart3, HeartPulse, Contact, Landmark, ClipboardList, GitBranch } from "lucide-react";

// Grouped by what a person is trying to DO, not by feature. Five short
// sections to scan instead of eleven flat tabs - much easier for new or
// less technical users to find their way. The three People items were the
// biggest source of confusion ("Legislators" vs "Members" vs "Team" all
// sound alike), so they're renamed to say plainly what each is: Congress =
// the official directory of members of Congress; Contacts = your own
// stakeholder/CRM list; Team = your teammates with logins.
const NAV_GROUPS = [
  {
    label: "Track",
    items: [
      { href: "/dashboard", label: "My bills", Icon: FileText },
      { href: "/activity", label: "Activity", Icon: Activity },
    ],
  },
  {
    label: "Analyze",
    items: [
      { href: "/impact", label: "Impact", Icon: GitBranch },
      { href: "/statistics", label: "Statistics", Icon: BarChart3 },
      { href: "/rural-health", label: "Rural Health", Icon: HeartPulse },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/legislators", label: "Congress", Icon: Landmark },
      { href: "/members", label: "Contacts", Icon: Contact },
      { href: "/team", label: "Team", Icon: Users },
    ],
  },
  {
    label: "Reports",
    items: [{ href: "/briefing", label: "Briefing", Icon: ClipboardList }],
  },
];

// Plumbing and preferences sit apart at the foot of the nav, out of the
// daily path.
const UTILITY_ITEMS = [
  { href: "/api-usage", label: "API Usage", Icon: Gauge },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export default function Sidebar() {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  // Identity comes from the shared session (one fetch for the whole app)
  // rather than this component running its own auth + profile queries.
  const { email, org } = useSession();
  const orgName = org?.name ?? null;
  const logoUrl = org?.logo_url ?? null;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  useTicker(60_000);

  useEffect(() => {
    (async () => {
      // A small, honest "the system is actually watching" signal - real
      // data (the most recent poll across every bill we track), not just
      // decoration. One indexed query (see bills_last_polled_at_idx in
      // supabase/add-performance-indexes.sql), run once since this component
      // stays mounted across client-side navigation.
      const { data: recent } = await supabase
        .from("bills")
        .select("last_polled_at")
        .order("last_polled_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recent?.last_polled_at) setLastChecked(recent.last_polled_at);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
      <button className="sidebar-toggle" onClick={() => setMobileOpen((v) => !v)} aria-label="Toggle menu">
        <Menu size={18} />
      </button>

      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}

      <aside className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="sidebar-logo" />
          ) : (
            <div className="sidebar-logo sidebar-logo-placeholder">B</div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="brand" style={{ fontSize: '1.0625rem' }}>Bill Tracker</div>
            {orgName && <div className="sidebar-org">{orgName}</div>}
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="sidebar-group">
              <div className="sidebar-group-label">{group.label}</div>
              {group.items.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={`sidebar-link${pathname === item.href ? " sidebar-link-active" : ""}`}
                >
                  <item.Icon size={16} className="sidebar-icon" aria-hidden="true" />
                  {item.label}
                </a>
              ))}
            </div>
          ))}
          <div className="sidebar-group sidebar-group-utility">
            {UTILITY_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`sidebar-link${pathname === item.href ? " sidebar-link-active" : ""}`}
              >
                <item.Icon size={16} className="sidebar-icon" aria-hidden="true" />
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="sidebar-cmdk-hint muted">
          Press <kbd className="cmdk-kbd">⌘K</kbd> to jump anywhere
        </div>

        <div className="sidebar-footer">
          {lastChecked && (
            <div className="sidebar-status">
              <span className="live-dot" />
              Checked {timeAgo(lastChecked)}
            </div>
          )}
          {email && <div className="sidebar-email">{email}</div>}
          <button className="ghost" onClick={handleLogout} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <LogOut size={14} /> Log out
          </button>
        </div>
      </aside>
    </>
  );
}

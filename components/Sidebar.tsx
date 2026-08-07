"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV_ITEMS = [
  { href: "/dashboard", label: "My bills", icon: "☰" },
  { href: "/team", label: "Team", icon: "◈" },
  { href: "/activity", label: "Activity", icon: "◷" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export default function Sidebar() {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? null);

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, organizations(name, logo_url)")
        .eq("id", user.id)
        .single();

      const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
      setOrgName((org as any)?.name ?? null);
      setLogoUrl((org as any)?.logo_url ?? null);
    })();
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
        ☰
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
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`sidebar-link${pathname === item.href ? " sidebar-link-active" : ""}`}
            >
              <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          {email && <div className="sidebar-email">{email}</div>}
          <button className="ghost" onClick={handleLogout} style={{ width: "100%" }}>Log out</button>
        </div>
      </aside>
    </>
  );
}

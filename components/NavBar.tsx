"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function NavBar() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

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

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <nav className="nav">
      <div className="nav-left">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover" }} />
        )}
        <span className="brand">Bill Tracker</span>
        {orgName && <span className="org-name">{orgName}</span>}
        <div className="nav-links">
          <a href="/dashboard">My bills</a>
          <a href="/team">Team</a>
          <a href="/settings">Settings</a>
        </div>
      </div>
      <div className="nav-right">
        {email && <span className="user-email">{email}</span>}
        <button className="ghost" onClick={handleLogout}>Log out</button>
      </div>
    </nav>
  );
}

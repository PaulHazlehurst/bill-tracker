"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function NavBar() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? null);

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, organizations(name)")
        .eq("id", user.id)
        .single();

      const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
      setOrgName((org as any)?.name ?? null);
    })();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <nav className="nav">
      <div className="nav-left">
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

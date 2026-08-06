"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function NavBar() {
  const supabase = createClient();
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <nav className="nav">
      <div>
        <span className="brand">Bill Tracker</span>
        <a href="/dashboard">My bills</a>
        <a href="/team">Team</a>
      </div>
      <button className="ghost" onClick={handleLogout}>Log out</button>
    </nav>
  );
}

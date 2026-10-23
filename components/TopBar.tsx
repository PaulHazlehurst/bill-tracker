"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/SessionProvider";
import { timeAgo } from "@/lib/billMeta";
import { useTicker } from "@/lib/useTicker";
import { Search, Plus, Menu, Moon, Sun, LogOut, Settings, Keyboard } from "lucide-react";
import Link from "next/link";

// Sticky bar across the top of every signed-in page: search everything,
// track a new bill, see when Congress was last checked, and the account menu.
export function openPalette() {
  window.dispatchEvent(new CustomEvent("bt:open-palette"));
}
export function openFindBill(query?: string) {
  window.dispatchEvent(new CustomEvent("bt:find-bill", { detail: { query } }));
}

export default function TopBar() {
  const supabase = createClient();
  const router = useRouter();
  const { email } = useSession();
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [isMac, setIsMac] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  useTicker(60_000);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
    // When congress.gov was last checked for any bill - a small, honest
    // "the system is watching" signal. One indexed query, once per session.
    supabase
      .from("bills")
      .select("last_polled_at")
      .order("last_polled_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLastChecked(data?.last_polled_at ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  function toggleTheme() {
    const next = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.setAttribute("data-theme", next);
    try { window.localStorage.setItem("billtracker-theme", next); } catch {}
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const initial = (email ?? "?").slice(0, 1).toUpperCase();

  return (
    <div className="topbar">
      <button className="icon-btn topbar-menu" onClick={() => window.dispatchEvent(new CustomEvent("bt:open-nav"))} aria-label="Open menu">
        <Menu size={19} />
      </button>

      <button className="topbar-search" onClick={openPalette}>
        <Search size={16} aria-hidden="true" />
        <span className="topbar-search-text">Search your bills, pages, or a bill number</span>
        <kbd className="kbd">{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>

      <div className="topbar-right">
        {lastChecked && (
          <span className="topbar-status" title={`Congress.gov last checked ${new Date(lastChecked).toLocaleString()}`}>
            <span className="live-dot" aria-hidden="true" />
            Checked {timeAgo(lastChecked)}
          </span>
        )}
        <button className="btn btn-primary topbar-track" onClick={() => openFindBill()}>
          <Plus size={16} strokeWidth={2.4} /> <span>Track a bill</span>
        </button>
        <div className="topbar-account" ref={menuRef}>
          <button className="avatar-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Account menu" aria-expanded={menuOpen}>
            {initial}
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              {email && <div className="menu-head">{email}</div>}
              <button role="menuitem" className="menu-item" onClick={toggleTheme}>
                {dark ? <Sun size={15} /> : <Moon size={15} />} {dark ? "Light mode" : "Dark mode"}
              </button>
              <Link role="menuitem" className="menu-item" href="/settings" onClick={() => setMenuOpen(false)}>
                <Settings size={15} /> Settings
              </Link>
              <button role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("bt:shortcuts")); }}>
                <Keyboard size={15} /> Keyboard shortcuts
              </button>
              <div className="menu-sep" />
              <button role="menuitem" className="menu-item" onClick={handleLogout}>
                <LogOut size={15} /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

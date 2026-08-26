"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LayoutDashboard, Users2, Activity, Settings, FileText, Search, Compass } from "lucide-react";

type NavItem = { type: "nav"; label: string; href: string; icon: any };
type BillItem = { type: "bill"; label: string; href: string };
type Item = NavItem | BillItem;

const NAV_ITEMS: NavItem[] = [
  { type: "nav", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { type: "nav", label: "Discovery", href: "/discovery", icon: Compass },
  { type: "nav", label: "Team", href: "/team", icon: Users2 },
  { type: "nav", label: "Activity", href: "/activity", icon: Activity },
  { type: "nav", label: "Settings", href: "/settings", icon: Settings },
];

// Mounted once in the (app) layout so Cmd/Ctrl+K works from anywhere in the
// authenticated app - a fast way to jump straight to a page or a tracked
// bill without clicking through the sidebar and table. Bills are fetched
// lazily (only once the palette is actually opened), not on every page load.
export default function CommandPalette() {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [bills, setBills] = useState<BillItem[]>([]);
  const [billsLoaded, setBillsLoaded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
      if (!billsLoaded) loadBills();
    }
  }, [open]);

  async function loadBills() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("tracked_bills")
      .select("bill_id, bills(title)")
      .eq("user_id", user.id)
      .limit(200);
    const items: BillItem[] = (data ?? []).map((row: any) => {
      const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
      return { type: "bill", label: bill?.title ?? row.bill_id, href: `/bill/${row.bill_id}` };
    });
    setBills(items);
    setBillsLoaded(true);
  }

  const q = query.trim().toLowerCase();
  const matchedNav = q ? NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(q)) : NAV_ITEMS;
  const matchedBills = q ? bills.filter((b) => b.label.toLowerCase().includes(q)).slice(0, 8) : bills.slice(0, 5);
  const results: Item[] = [...matchedNav, ...matchedBills];

  function go(item: Item) {
    router.push(item.href);
    setOpen(false);
  }

  function handleKeyNav(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      go(results[activeIndex]);
    }
  }

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <Search size={16} className="muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyNav}
            placeholder="Jump to a page or a tracked bill…"
            className="cmdk-input"
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>
        <div className="cmdk-results">
          {results.length === 0 && <div className="cmdk-empty muted">No matches</div>}
          {matchedNav.length > 0 && (
            <div className="cmdk-group-label">Go to</div>
          )}
          {matchedNav.map((item, i) => (
            <button
              key={item.href}
              className={`cmdk-item ${results.indexOf(item) === activeIndex ? "cmdk-item-active" : ""}`}
              onClick={() => go(item)}
              onMouseEnter={() => setActiveIndex(results.indexOf(item))}
            >
              <item.icon size={15} />
              {item.label}
            </button>
          ))}
          {matchedBills.length > 0 && (
            <div className="cmdk-group-label">Tracked bills</div>
          )}
          {matchedBills.map((item) => (
            <button
              key={item.href}
              className={`cmdk-item ${results.indexOf(item) === activeIndex ? "cmdk-item-active" : ""}`}
              onClick={() => go(item)}
              onMouseEnter={() => setActiveIndex(results.indexOf(item))}
            >
              <FileText size={15} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

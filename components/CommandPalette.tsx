"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/SessionProvider";
import { citationFor } from "@/lib/billMeta";
import {
  LayoutGrid, Users, Activity, Settings, FileText, Search, Landmark, GitBranch, ClipboardList, Contact, Columns3, Scale, BarChart3, Plus, ArrowRight, Gauge,
} from "lucide-react";

type Item = { id: string; group: string; label: string; hint?: string; icon: any; run: () => void };

const PAGES = [
  { label: "My bills", href: "/dashboard", icon: LayoutGrid, words: "dashboard home tracked" },
  { label: "Activity", href: "/activity", icon: Activity, words: "feed changes updates" },
  { label: "Regulations", href: "/regulations", icon: Scale, words: "federal register rules" },
  { label: "Impact", href: "/impact", icon: GitBranch, words: "health portfolio momentum" },
  { label: "Statistics", href: "/statistics", icon: BarChart3, words: "charts analytics" },
  { label: "Compare bills", href: "/compare", icon: Columns3, words: "side by side" },
  { label: "Congress", href: "/legislators", icon: Landmark, words: "legislators members senators representatives" },
  { label: "Contacts", href: "/members", icon: Contact, words: "stakeholders crm" },
  { label: "Team", href: "/team", icon: Users, words: "teammates tasks" },
  { label: "Briefing", href: "/briefing", icon: ClipboardList, words: "report print client" },
  { label: "Settings", href: "/settings", icon: Settings, words: "notifications email account" },
  { label: "Data sources", href: "/api-usage", icon: Gauge, words: "api usage quota" },
];

const CITATION_RX = /^(h\.?\s?r\.?|s\.?|h\.?\s?j\.?\s?res\.?|s\.?\s?j\.?\s?res\.?|h\.?\s?res\.?|s\.?\s?res\.?|h\.?\s?con\.?\s?res\.?|s\.?\s?con\.?\s?res\.?)\s*0*(\d{1,5})$/i;

function parseCitation(q: string): string | null {
  const m = q.trim().match(CITATION_RX);
  if (!m) return null;
  const type = m[1].toLowerCase().replace(/[.\s]/g, "");
  return `${type}-${m[2]}-119`;
}

// ⌘K / Ctrl+K from anywhere: jump to a page or one of your bills, open any
// bill by number ("hr 1234"), or hand the text to full bill search.
export default function CommandPalette() {
  const supabase = createClient();
  const router = useRouter();
  const { userId } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [bills, setBills] = useState<{ id: string; title: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("bt:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("bt:open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 10);
    if (!loaded && userId) {
      // RLS returns your own and your team's tracked bills.
      supabase
        .from("tracked_bills")
        .select("bill_id, bills(title)")
        .limit(300)
        .then(({ data }) => {
          const seen = new Set<string>();
          const list: { id: string; title: string }[] = [];
          for (const row of (data as any[]) ?? []) {
            if (seen.has(row.bill_id)) continue;
            seen.add(row.bill_id);
            const b = Array.isArray(row.bills) ? row.bills[0] : row.bills;
            list.push({ id: row.bill_id, title: b?.title ?? row.bill_id });
          }
          setBills(list);
          setLoaded(true);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const go = (href: string) => () => { router.push(href); setOpen(false); };
    const out: Item[] = [];

    const cite = parseCitation(query);
    if (cite) {
      out.push({ id: `open-${cite}`, group: "Bill number", label: `Open ${citationFor(cite)}`, hint: "119th Congress", icon: FileText, run: go(`/bill/${cite}`) });
    }

    const words = q.split(/\s+/).filter(Boolean);
    const billMatches = (words.length ? bills.filter((b) => words.every((w) => `${b.title} ${citationFor(b.id)} ${citationFor(b.id).replace(/\./g, "")} ${b.id.replace(/-/g, " ")}`.toLowerCase().includes(w.replace(/\./g, "")))) : bills).slice(0, words.length ? 8 : 4);
    for (const b of billMatches) {
      out.push({ id: `bill-${b.id}`, group: "Tracked bills", label: b.title, hint: citationFor(b.id), icon: FileText, run: go(`/bill/${b.id}`) });
    }

    const pageMatches = words.length ? PAGES.filter((p) => words.every((w) => `${p.label} ${p.words}`.toLowerCase().includes(w))) : PAGES;
    for (const p of pageMatches) out.push({ id: `page-${p.href}`, group: "Go to", label: p.label, icon: p.icon, run: go(p.href) });

    if (q.length >= 2 && !cite) {
      out.push({
        id: "search-all",
        group: "Search Congress",
        label: `Search all bills for “${query.trim()}”`,
        icon: Search,
        run: () => { setOpen(false); window.dispatchEvent(new CustomEvent("bt:find-bill", { detail: { query: query.trim() } })); },
      });
    }
    if (!q) {
      out.push({ id: "track", group: "Actions", label: "Track a new bill", icon: Plus, run: () => { setOpen(false); window.dispatchEvent(new CustomEvent("bt:find-bill")); } });
    }
    return out;
  }, [query, bills, router]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); items[active].run(); }
  }

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="overlay overlay-top" onMouseDown={() => setOpen(false)}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Command menu" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Type a page, a bill you track, or a number like hr 1234"
            aria-label="Search"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && <div className="palette-empty">Nothing matches. Press Enter on “Search all bills” to look across Congress.</div>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item${i === active ? " is-active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={item.run}
                >
                  <item.icon size={16} aria-hidden="true" />
                  <span className="palette-label">{item.label}</span>
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                  {i === active && <ArrowRight size={14} className="palette-enter" aria-hidden="true" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

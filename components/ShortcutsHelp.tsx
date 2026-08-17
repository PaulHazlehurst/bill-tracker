"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const SHORTCUTS = [
  { keys: ["⌘", "K"], altKeys: ["Ctrl", "K"], label: "Jump to any page or tracked bill" },
  { keys: ["/"], label: "Focus the search box (on your dashboard)" },
  { keys: ["?"], label: "Show this list" },
  { keys: ["Esc"], label: "Close any open dialog" },
];

// Mounted once globally alongside CommandPalette. Listens for "?" - but
// only when the person isn't actively typing somewhere else, so it never
// interrupts entering a "?" character in a real text field.
export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (e.key === "?" && !isTyping) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "/" && !isTyping) {
        const searchInput = document.getElementById("bill-search-input");
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
        }
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Keyboard shortcuts</span>
          <button className="ghost" style={{ marginLeft: "auto", padding: "4px 8px" }} onClick={() => setOpen(false)} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: 12 }}>
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="shortcut-row">
              <span className="muted" style={{ fontSize: '0.8125rem' }}>{s.label}</span>
              <span style={{ display: "flex", gap: 4 }}>
                {s.keys.map((k) => <kbd key={k} className="cmdk-kbd">{k}</kbd>)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

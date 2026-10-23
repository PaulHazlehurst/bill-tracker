"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Search pages, your bills, or a bill number" },
  { keys: ["/"], label: "Search all bills in Congress" },
  { keys: ["T"], label: "Track a bill" },
  { keys: ["?"], label: "Show these shortcuts" },
  { keys: ["Esc"], label: "Close any dialog" },
];

// Global keyboard shortcuts. Ignored while typing in a field, so "?" or "/"
// can still be typed normally.
export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "/" || e.key.toLowerCase() === "t") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("bt:find-bill"));
      } else if (e.key === "Escape") setOpen(false);
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("bt:shortcuts", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("bt:shortcuts", onOpen);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="overlay" onMouseDown={() => setOpen(false)}>
      <div className="dialog dialog-sm" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 className="dialog-title">Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button>
        </div>
        <ul className="shortcut-list">
          {SHORTCUTS.map((s) => (
            <li key={s.label}>
              <span>{s.label}</span>
              <span className="shortcut-keys">{s.keys.map((k) => <kbd key={k} className="kbd">{k}</kbd>)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

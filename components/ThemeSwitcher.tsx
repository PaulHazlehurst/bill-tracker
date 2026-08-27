"use client";

import { useEffect, useState } from "react";

const THEMES = [
  { id: "terminal", label: "Terminal", swatch: "#0d1219" },
  { id: "terminal-light", label: "Terminal Light", swatch: "#eef1f5" },
] as const;

const VALID = new Set<string>(THEMES.map((t) => t.id));
const STORAGE_KEY = "billtracker-theme";

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>("terminal");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    // Ignore stale theme names from the old (Capitol/Parchment/Midnight)
    // palette so the switcher never shows an option that no longer exists.
    if (saved && VALID.has(saved)) setTheme(saved);
  }, []);

  function choose(id: string) {
    setTheme(id);
    document.documentElement.setAttribute("data-theme", id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }

  return (
    <div className="theme-switcher" role="group" aria-label="Choose a theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          aria-label={t.label}
          aria-pressed={theme === t.id}
          style={{ background: t.swatch }}
          onClick={() => choose(t.id)}
        />
      ))}
    </div>
  );
}

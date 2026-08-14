"use client";

import { useEffect, useState } from "react";

const THEMES = [
  { id: "parchment", label: "Parchment", swatch: "#2f5d50" },
  { id: "midnight", label: "Midnight", swatch: "#14181a" },
  { id: "capitol", label: "Capitol", swatch: "#1f3a5f" },
] as const;

const STORAGE_KEY = "billtracker-theme";

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>("parchment");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setTheme(saved);
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

"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "billtracker-theme";
const OPTIONS = [
  { id: "system", label: "Match my device" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

// Light, dark, or follow the operating system's setting (the default).
export default function ThemeSwitcher() {
  const [choice, setChoice] = useState<string>("system");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark") setChoice(saved);
    } catch {}
  }, []);

  function choose(id: string) {
    setChoice(id);
    try {
      if (id === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, id);
    } catch {}
    const dark = id === "dark" || (id === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }

  return (
    <div className="seg" role="group" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" className={choice === o.id ? "is-on" : ""} aria-pressed={choice === o.id} onClick={() => choose(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

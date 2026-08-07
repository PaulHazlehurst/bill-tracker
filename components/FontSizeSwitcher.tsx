"use client";

import { useEffect, useState } from "react";

const SIZES = [
  { id: "sm", label: "Small" },
  { id: "md", label: "Medium" },
  { id: "lg", label: "Large" },
] as const;

const STORAGE_KEY = "billtracker-font-size";

export default function FontSizeSwitcher() {
  const [size, setSize] = useState<string>("md");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setSize(saved);
  }, []);

  function choose(id: string) {
    setSize(id);
    // "md" is the default and has no data-font-size override in CSS, so we
    // can just remove the attribute rather than setting it to "md".
    if (id === "md") {
      document.documentElement.removeAttribute("data-font-size");
    } else {
      document.documentElement.setAttribute("data-font-size", id);
    }
    window.localStorage.setItem(STORAGE_KEY, id);
  }

  return (
    <div className="font-size-switcher" role="group" aria-label="Choose text size">
      {SIZES.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={size === s.id}
          onClick={() => choose(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

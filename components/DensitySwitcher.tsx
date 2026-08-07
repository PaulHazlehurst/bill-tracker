"use client";

import { useEffect, useState } from "react";

const OPTIONS = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
] as const;

const STORAGE_KEY = "billtracker-density";

export default function DensitySwitcher() {
  const [density, setDensity] = useState<string>("comfortable");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setDensity(saved);
  }, []);

  function choose(id: string) {
    setDensity(id);
    if (id === "comfortable") {
      document.documentElement.removeAttribute("data-density");
    } else {
      document.documentElement.setAttribute("data-density", id);
    }
    window.localStorage.setItem(STORAGE_KEY, id);
  }

  return (
    <div className="font-size-switcher" role="group" aria-label="Choose table density">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" aria-pressed={density === o.id} onClick={() => choose(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

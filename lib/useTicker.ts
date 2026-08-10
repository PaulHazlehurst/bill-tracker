"use client";

import { useEffect, useState } from "react";

// Forces a re-render every `intervalMs`, with no data fetch involved -
// just makes anything computed from timeAgo() during render (like "Checked
// 3m ago") visibly count up on its own instead of only updating on the
// next full page load. This is what makes the app feel alive without
// costing a single extra request.
export function useTicker(intervalMs = 60_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

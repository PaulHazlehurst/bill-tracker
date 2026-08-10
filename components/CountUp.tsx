"use client";

import { useEffect, useRef, useState } from "react";

// Animates a number counting up to its target on mount/change. Purely
// visual - the value itself always comes from data we already have, this
// just makes it land with a bit of motion instead of popping in static.
export default function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      prevValue.current = value;
      return;
    }

    const from = prevValue.current;
    const to = value;
    const duration = 500;
    const start = performance.now();

    let raf: number;
    function step(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(step);
      else prevValue.current = to;
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{display}</>;
}

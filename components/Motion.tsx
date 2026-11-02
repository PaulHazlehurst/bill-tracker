"use client";

import { ViewTransition, useEffect, useRef, useState } from "react";

/**
 * Wrap each item of a list that people add to or remove from. Put the list
 * item's key on this component. When the change runs through animated() or
 * optimistic() (lib/motion.ts), the item fades out or in and its neighbours
 * slide into place.
 */
export function MotionItem({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="item-in" exit="item-out" update="item-move" default="none">
      {children}
    </ViewTransition>
  );
}

const prefersLessMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * A number that counts to its new value when it changes (not on first
 * show), so a count going from 7 to 5 reads as a change rather than a
 * different screen. Screen readers get the final value straight away.
 */
export function AnimatedNumber({ value, format = (n) => n.toLocaleString() }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    if (prefersLessMotion()) {
      setShown(value);
      return;
    }
    const began = performance.now();
    const duration = Math.min(700, 260 + Math.abs(value - start) * 40);
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value]);

  return (
    <span className="num-anim">
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

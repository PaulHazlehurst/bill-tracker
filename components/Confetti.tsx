"use client";

import { useEffect, useState } from "react";

const COLORS = ["var(--accent)", "var(--pos-support)", "var(--pos-watching)", "var(--party-dem)", "var(--party-rep)"];

// Lightweight DOM-based confetti burst - no canvas, no external library.
// Fires once on mount, pieces animate out and the whole thing unmounts
// itself after the animation finishes. Respects prefers-reduced-motion by
// not rendering at all.
export default function Confetti() {
  const [pieces, setPieces] = useState<{ id: number; left: number; delay: number; color: string; rotation: number }[]>([]);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(false);
      return;
    }
    setPieces(
      Array.from({ length: 40 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.4,
        color: COLORS[i % COLORS.length],
        rotation: Math.random() * 360,
      }))
    );
    const timer = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="confetti-container" aria-hidden="true">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            background: p.color,
            transform: `rotate(${p.rotation}deg)`,
          }}
        />
      ))}
    </div>
  );
}

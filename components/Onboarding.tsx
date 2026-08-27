"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HelpCircle, X } from "lucide-react";

// A first-run coach-mark overlay. Rather than a heavy modal tour, it draws
// low-opacity hand-drawn arrows pointing at the three things a new user needs
// to understand — topics, search, and the tracked list — all at once, so the
// whole dashboard's shape is legible in one glance. It measures the real
// elements (by data-coach attribute) and repositions on scroll/resize, so it
// stays accurate no matter the layout. Desktop-only: below 900px the layout
// reflows and the inline empty-state hints carry the load instead.
const SEEN_KEY = "billtracker-coach-seen-v1";

type Step = {
  sel: string;
  n: number;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    sel: '[data-coach="topics"]',
    n: 1,
    title: "Tell it what to watch",
    body: "Add topics you care about — it checks for matching new bills every day, on its own.",
  },
  {
    sel: '[data-coach="search"]',
    n: 2,
    title: "Or find one directly",
    body: "Search any bill by name or number, then track it in one click.",
  },
  {
    sel: '[data-coach="tracked"]',
    n: 3,
    title: "Everything you follow",
    body: "Your tracked bills live here with live status, positions, and alerts.",
  },
];

type Placed = Step & {
  card: { left: number; top: number; side: "left" | "right" };
  arrow: { d: string; head: string };
};

const CARD_W = 244;

function buildArrow(sx: number, sy: number, ex: number, ey: number) {
  // A gently curved, slightly wobbly line for a hand-drawn feel, ending in a
  // small arrowhead aimed along the incoming direction.
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const dx = ex - sx;
  const dy = ey - sy;
  const len = Math.hypot(dx, dy) || 1;
  // perpendicular offset for the curve
  const nx = -dy / len;
  const ny = dx / len;
  const bow = Math.min(46, len * 0.28);
  const c1x = mx + nx * bow;
  const c1y = my + ny * bow;
  const d = `M ${sx} ${sy} Q ${c1x} ${c1y} ${ex} ${ey}`;
  // arrowhead: direction from control point to end
  const adx = ex - c1x;
  const ady = ey - c1y;
  const aa = Math.atan2(ady, adx);
  const size = 11;
  const a1 = aa + Math.PI - 0.45;
  const a2 = aa + Math.PI + 0.45;
  const h1x = ex + Math.cos(a1) * size;
  const h1y = ey + Math.sin(a1) * size;
  const h2x = ex + Math.cos(a2) * size;
  const h2y = ey + Math.sin(a2) * size;
  const head = `M ${h1x} ${h1y} L ${ex} ${ey} L ${h2x} ${h2y}`;
  return { d, head };
}

export default function Onboarding() {
  const [active, setActive] = useState(false);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [showReplay, setShowReplay] = useState(false);
  const rafRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 900) {
      setPlaced([]);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const next: Placed[] = [];
    for (const step of STEPS) {
      const el = document.querySelector(step.sel) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // Skip anything scrolled fully out of view.
      if (r.bottom < 8 || r.top > vh - 8) continue;
      const roomRight = vw - r.right;
      const side: "left" | "right" = roomRight > CARD_W + 60 ? "right" : "left";
      let cardTop = r.top + r.height / 2 - 46;
      cardTop = Math.max(12, Math.min(cardTop, vh - 150));
      let cardLeft: number;
      let sx: number;
      const sy = cardTop + 34;
      let ex: number;
      const ey = Math.max(12, Math.min(r.top + Math.min(r.height / 2, 40), vh - 12));
      if (side === "right") {
        cardLeft = Math.min(r.right + 30, vw - CARD_W - 12);
        sx = cardLeft;
        ex = r.right + 3;
      } else {
        cardLeft = Math.max(12, r.left - CARD_W - 30);
        sx = cardLeft + CARD_W;
        ex = r.left - 3;
      }
      const arrow = buildArrow(sx, sy, ex, ey);
      next.push({ ...step, card: { left: cardLeft, top: cardTop, side }, arrow });
    }
    setPlaced(next);
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(measure);
  }, [measure]);

  // Decide on mount whether this is a first run.
  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = false;
    }
    if (seen) {
      setShowReplay(true);
    } else {
      // Give the dashboard a beat to render its real content before we measure.
      const t = setTimeout(() => setActive(true), 650);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    measure();
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    const iv = setInterval(measure, 800); // catches late async content shifts
    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      clearInterval(iv);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, measure, scheduleMeasure]);

  function dismiss() {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode — fine, it just shows again next time */
    }
    setActive(false);
    setShowReplay(true);
  }

  function replay() {
    setShowReplay(false);
    setActive(true);
  }

  if (showReplay && !active) {
    return (
      <button className="coach-replay" onClick={replay} aria-label="Show the quick tour again" title="Quick tour">
        <HelpCircle size={18} />
      </button>
    );
  }

  if (!active) return null;

  return (
    <div className="coach-overlay" role="dialog" aria-label="Getting started tour">
      <div className="coach-scrim" onClick={dismiss} />
      {placed.length > 0 && (
        <svg className="coach-svg" aria-hidden="true">
          {placed.map((p) => (
            <g key={p.n} className="coach-arrow">
              <path d={p.arrow.d} fill="none" />
              <path d={p.arrow.head} fill="none" />
            </g>
          ))}
        </svg>
      )}
      {placed.map((p) => (
        <div
          key={p.n}
          className={`coach-card coach-card-${p.card.side}`}
          style={{ left: p.card.left, top: p.card.top, width: CARD_W }}
        >
          <div className="coach-card-n">{p.n}</div>
          <div className="coach-card-title">{p.title}</div>
          <div className="coach-card-body">{p.body}</div>
        </div>
      ))}
      <div className="coach-bar">
        {placed.length === 0 ? (
          <span className="coach-bar-note">Welcome — this is your dashboard.</span>
        ) : (
          <span className="coach-bar-note">A quick lay of the land.</span>
        )}
        <button className="coach-done" onClick={dismiss}>
          Got it <X size={13} />
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Search, Check, Plus } from "lucide-react";
import RouteLine from "@/components/ui/RouteLine";
import { openFindBill } from "@/components/TopBar";

// The first thing a brand-new account sees. Shows what tracking looks like
// with one real, fully-enacted bill, and points at the two ways to start:
// search for a bill, or name topics in Discover (alongside).
export default function FirstRunHero({ onTracked }: { onTracked: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function trackExample() {
    setState("busy");
    const res = await fetch("/api/bills/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ congress: 119, billType: "hr", billNumber: 1 }),
    }).catch(() => null);
    if (res?.ok) {
      setState("done");
      onTracked();
    } else setState("idle");
  }

  return (
    <section className="firstrun">
      <h2 className="firstrun-title">Every bill you follow, drawn as the route it takes through Congress.</h2>
      <p className="firstrun-sub">
        Track a bill and you'll see where it stands, what changed overnight, and what each step means in plain English.
        We check congress.gov every morning and can email or text you when something moves.
      </p>

      <div className="firstrun-example">
        <div className="firstrun-example-meta">
          <span className="cite">H.R. 1</span>
          <span className="stage-pill tone-law">Became law</span>
        </div>
        <p className="firstrun-example-title">One Big Beautiful Bill Act</p>
        <RouteLine stage="enacted" billType="hr" size="lg" />
        <button className="btn btn-secondary" onClick={trackExample} disabled={state !== "idle"}>
          {state === "done" ? <><Check size={16} /> Tracking H.R. 1</> : state === "busy" ? "Tracking…" : <><Plus size={16} /> Track this example</>}
        </button>
      </div>

      <div className="firstrun-actions">
        <button className="btn btn-primary btn-lg" onClick={() => openFindBill()}>
          <Search size={17} /> Find a bill to track
        </button>
        <span className="firstrun-or">or add topics in Discover and we'll suggest bills for you.</span>
      </div>
    </section>
  );
}

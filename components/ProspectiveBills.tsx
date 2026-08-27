"use client";

import { useEffect, useState } from "react";
import { Sparkles, Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import { avatarColorFor } from "@/lib/billMeta";

type ProspectiveItem = {
  id: string;
  bill_id: string;
  matched_topic: string;
  discovered_at: string;
  bills: { title: string; status_stage: string; progress_pct: number } | { title: string; status_stage: string; progress_pct: number }[] | null;
};

// Bills matching the org's declared topics that aren't tracked yet. Kept
// deliberately compact and collapsible: it lives above the tracked-bills
// table, so it must never dominate the screen no matter how many matches
// discovery finds. The list is bounded by a fixed-height scroll area.
export default function ProspectiveBills({ onTracked }: { onTracked: () => void }) {
  const [items, setItems] = useState<ProspectiveItem[] | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    load();
  }, []);

  function load() {
    fetch("/api/prospective")
      .then((r) => r.json())
      .then((b) => setItems(b.prospective ?? []))
      .catch(() => setItems([]));
  }

  async function handleTrack(item: ProspectiveItem) {
    const bill = Array.isArray(item.bills) ? item.bills[0] : item.bills;
    if (!bill) return;
    setActingOn(item.id);
    const [billType, billNumber, congress] = item.bill_id.split("-");
    try {
      const res = await fetch("/api/bills/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ congress: Number(congress), billType, billNumber: Number(billNumber) }),
      });
      if (res.ok) {
        await fetch("/api/prospective", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        });
        setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
        onTracked();
      }
    } finally {
      setActingOn(null);
    }
  }

  async function handleDismiss(item: ProspectiveItem) {
    setActingOn(item.id);
    try {
      await fetch("/api/prospective", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
    } finally {
      setActingOn(null);
    }
  }

  if (items === null || items.length === 0) return null;

  return (
    <div className="prospect">
      <button className="prospect-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="prospect-eyebrow"><Sparkles size={13} /> Bills you'd be interested in</span>
        <span className="prospect-count">{items.length}</span>
        <span className="prospect-chevron">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>

      {open && (
        <div className="prospect-list">
          {items.map((item) => {
            const bill = Array.isArray(item.bills) ? item.bills[0] : item.bills;
            if (!bill) return null;
            const color = avatarColorFor(item.matched_topic);
            return (
              <div key={item.id} className="prospect-row">
                <span className="prospect-tag" style={{ color, borderColor: color }}>{item.matched_topic}</span>
                <a href={`/bill/${item.bill_id}`} className="prospect-title" title={bill.title}>{bill.title}</a>
                <div className="prospect-actions">
                  <button className="primary prospect-track" onClick={() => handleTrack(item)} disabled={actingOn === item.id}>
                    <Plus size={12} /> Track
                  </button>
                  <button className="ghost prospect-x" onClick={() => handleDismiss(item)} disabled={actingOn === item.id} title="Not interested" aria-label="Dismiss">
                    <X size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

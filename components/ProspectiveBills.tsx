"use client";

import { useEffect, useState } from "react";
import { Sparkles, Plus, X } from "lucide-react";
import { avatarColorFor } from "@/lib/billMeta";

type ProspectiveItem = {
  id: string;
  bill_id: string;
  matched_topic: string;
  discovered_at: string;
  bills: { title: string; status_stage: string; progress_pct: number } | { title: string; status_stage: string; progress_pct: number }[] | null;
};

// The new headline of the dashboard, per the company's direction: bills
// matching the org's declared topics that aren't tracked yet and aren't
// companion/duplicate versions of something that is (see
// lib/topicDiscovery.ts for the actual matching logic - this component
// just displays and acts on what that already found).
export default function ProspectiveBills({ onTracked }: { onTracked: () => void }) {
  const [items, setItems] = useState<ProspectiveItem[] | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

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
    <div className="prospective-section">
      <div className="prospective-header">
        <Sparkles size={16} style={{ color: "var(--accent-gold)" }} />
        <div>
          <span className="page-eyebrow">Bills you'd be interested in</span>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 500, margin: 0, fontFamily: 'var(--font-display), Georgia, serif' }}>
            Worth tracking
          </h2>
          <p className="settings-desc" style={{ margin: "2px 0 0" }}>
            Matched to your topics, not already on your list.
          </p>
        </div>
      </div>
      <div className="prospective-grid">
        {items.map((item) => {
          const bill = Array.isArray(item.bills) ? item.bills[0] : item.bills;
          if (!bill) return null;
          return (
            <div key={item.id} className="prospective-card" style={{ borderLeftColor: avatarColorFor(item.matched_topic) }}>
              <span className="prospective-topic-tag" style={{ color: avatarColorFor(item.matched_topic), borderColor: avatarColorFor(item.matched_topic) }}>{item.matched_topic}</span>
              <a href={`/bill/${item.bill_id}`} className="prospective-card-title">{bill.title}</a>
              <div className="prospective-card-actions">
                <button className="primary" onClick={() => handleTrack(item)} disabled={actingOn === item.id}>
                  <Plus size={13} /> Track
                </button>
                <button className="ghost" onClick={() => handleDismiss(item)} disabled={actingOn === item.id} title="Not interested">
                  <X size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

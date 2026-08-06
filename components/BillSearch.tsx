"use client";

import { useState } from "react";

type SearchResult = {
  congress: number;
  type: string;
  number: string;
  title: string;
};

export default function BillSearch({ onTracked }: { onTracked: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    const res = await fetch(`/api/bills/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setResults(data.bills ?? []);
    setLoading(false);
  }

  async function handleTrack(r: SearchResult) {
    const key = `${r.type}-${r.number}-${r.congress}`;
    setTrackingId(key);
    await fetch("/api/bills/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ congress: r.congress, billType: r.type, billNumber: Number(r.number) }),
    });
    setTrackingId(null);
    setResults([]);
    setQ("");
    onTracked();
  }

  return (
    <div className="card">
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 6 }}
          placeholder="Search bills by keyword, e.g. 'infrastructure'"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {results.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {results.map((r) => {
            const key = `${r.type}-${r.number}-${r.congress}`;
            return (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                <div>
                  <div style={{ fontSize: 14 }}>{r.title}</div>
                  <div className="muted">{r.type.toUpperCase()} {r.number} · {r.congress}th Congress</div>
                </div>
                <button className="ghost" onClick={() => handleTrack(r)} disabled={trackingId === key}>
                  {trackingId === key ? "Adding…" : "Track"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

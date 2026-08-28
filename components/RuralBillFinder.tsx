"use client";

import { useEffect, useState } from "react";
import { useUI } from "@/components/UIProvider";
import { Search, Plus, Check, FileText, ExternalLink } from "lucide-react";

// The part of the Rural Health page that turns data into action.
//
// The shortage numbers above this component tell you WHERE the problem is.
// This tells you what Congress is actually doing about it - and lets you
// start tracking any of it in one click, without leaving the page or
// guessing which search terms surface rural-health legislation.
//
// The presets are curated policy areas rather than raw keywords, because a
// single word doesn't describe a policy area: "telehealth" alone misses
// "remote patient monitoring." Each preset runs several searches server-side
// and merges the results (see app/api/rural-health/bills/route.ts).

const PRESETS: { key: string; label: string }[] = [
  { key: "rural-hospitals", label: "Rural hospitals" },
  { key: "telehealth", label: "Telehealth" },
  { key: "workforce", label: "Workforce & shortages" },
  { key: "medicare-medicaid", label: "Medicare & Medicaid" },
  { key: "maternal", label: "Rural maternal health" },
  { key: "behavioral", label: "Behavioral & opioid" },
  { key: "ems", label: "EMS & ambulance" },
  { key: "clinics", label: "Clinics & health centers" },
  { key: "broadband", label: "Broadband for care" },
];

type FoundBill = {
  id: string;
  congress: number;
  billType: string;
  billNumber: string;
  title: string;
  tracked: boolean;
};

export default function RuralBillFinder() {
  const { toast } = useUI();
  const [activePreset, setActivePreset] = useState<string>("rural-hospitals");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [bills, setBills] = useState<FoundBill[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePreset, submittedQuery]);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const params = submittedQuery
        ? `q=${encodeURIComponent(submittedQuery)}`
        : `topic=${encodeURIComponent(activePreset)}`;
      const res = await fetch(`/api/rural-health/bills?${params}`);
      const body = await res.json();
      if (body.error) setError(body.error);
      setBills(body.bills ?? []);
    } catch {
      setError("Couldn't load legislation right now.");
      setBills([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSubmittedQuery(query.trim());
  }

  function choosePreset(key: string) {
    setQuery("");
    setSubmittedQuery("");
    setActivePreset(key);
  }

  async function track(bill: FoundBill) {
    setTrackingId(bill.id);
    try {
      const res = await fetch("/api/bills/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          congress: bill.congress,
          billType: bill.billType.toLowerCase(),
          billNumber: Number(bill.billNumber),
        }),
      });
      if (res.ok) {
        setBills((prev) => (prev ?? []).map((b) => (b.id === bill.id ? { ...b, tracked: true } : b)));
        toast("Now tracking this bill", "success");
      } else {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? "Couldn't track that bill", "error");
      }
    } finally {
      setTrackingId(null);
    }
  }

  return (
    <div className="rbf">
      <div className="rbf-head">
        <div>
          <h2 className="section-title">
            <FileText size={16} style={{ color: "var(--accent)", marginRight: 8, verticalAlign: -2 }} />
            What Congress is doing about it
          </h2>
          <p className="settings-desc" style={{ marginTop: 4 }}>
            Live search across the full text of the 119th Congress. Pick an issue or search your own terms, then track anything worth watching.
          </p>
        </div>
        <form onSubmit={handleSearch} className="rbf-search">
          <Search size={14} className="rbf-search-icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bill text, e.g. swing bed"
            aria-label="Search rural health legislation"
          />
          <button type="submit" className="primary">Search</button>
        </form>
      </div>

      <div className="rbf-presets">
        {PRESETS.map((p) => {
          const active = !submittedQuery && activePreset === p.key;
          return (
            <button
              key={p.key}
              onClick={() => choosePreset(p.key)}
              className={`rbf-preset${active ? " rbf-preset-active" : ""}`}
              aria-pressed={active}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {submittedQuery && (
        <p className="muted" style={{ fontSize: "0.8125rem", marginBottom: 10 }}>
          Results for <strong style={{ color: "var(--text)" }}>“{submittedQuery}”</strong> ·{" "}
          <button className="rbf-clear" onClick={() => choosePreset(activePreset)}>clear</button>
        </p>
      )}

      {loading ? (
        <div className="rbf-loading">
          {[0, 1, 2, 3].map((i) => <div key={i} className="rbf-skel" />)}
        </div>
      ) : error ? (
        <p className="muted">{error}</p>
      ) : !bills || bills.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          No bills matched that. Try a broader phrase, or one of the issue buttons above.
        </p>
      ) : (
        <div className="rbf-list">
          {bills.map((b) => (
            <div key={b.id} className="rbf-row">
              <span className="rbf-num">{b.billType.toUpperCase()} {b.billNumber}</span>
              <a href={`/bill/${b.id}`} className="rbf-title" title={b.title}>{b.title}</a>
              <div className="rbf-actions">
                <a
                  href={`https://www.congress.gov/bill/${b.congress}th-congress/${
                    b.billType.toLowerCase() === "hr" ? "house-bill" : b.billType.toLowerCase() === "s" ? "senate-bill" : b.billType.toLowerCase()
                  }/${b.billNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rbf-ext"
                  aria-label="View on congress.gov"
                  title="View on congress.gov"
                >
                  <ExternalLink size={13} />
                </a>
                {b.tracked ? (
                  <span className="rbf-tracked"><Check size={13} /> Tracking</span>
                ) : (
                  <button className="primary rbf-track" onClick={() => track(b)} disabled={trackingId === b.id}>
                    <Plus size={12} /> {trackingId === b.id ? "Adding…" : "Track"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

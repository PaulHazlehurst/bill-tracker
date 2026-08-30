"use client";

import { useMemo, useState } from "react";
import { faviconFor, formatDate, initialsFor } from "@/lib/billMeta";

// The bill page's "related news" panel, extracted out of the page component
// so it can carry its own filter state without bloating the parent.
//
// What's different from the old inline version:
//   * freshness filter (last 24h, this week, all)
//   * outlet-tier filter (all, wire, mainstream, trade, local)
//   * shows the feed-provided snippet under each headline
//   * uses the extracted publisher URL when available, so clicks bypass
//     Google News's redirector - faster and gives the favicon lookup
//     the right domain

type NewsItem = {
  title: string;
  source: string;
  url: string;
  publisherUrl?: string | null;
  publishedAt: string | null;
  snippet?: string | null;
  tier?: "wire" | "mainstream" | "trade" | "local" | "other";
};

const TIER_LABEL: Record<NonNullable<NewsItem["tier"]>, string> = {
  wire: "Wire",
  mainstream: "Mainstream",
  trade: "Trade",
  local: "Local",
  other: "Other",
};

const RANGES: { key: "24h" | "week" | "all"; label: string; ms: number | null }[] = [
  { key: "24h", label: "Last 24h", ms: 24 * 60 * 60 * 1000 },
  { key: "week", label: "This week", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All", ms: null },
];

export default function BillNewsSection({ newsItems }: { newsItems: NewsItem[] }) {
  // Which tiers actually appear in this bill's coverage. No point offering
  // a "Wire" filter chip on a bill that has no wire articles.
  const availableTiers = useMemo(() => {
    const s = new Set<NonNullable<NewsItem["tier"]>>();
    for (const n of newsItems) if (n.tier) s.add(n.tier);
    return s;
  }, [newsItems]);

  // Default to "mainstream" so the first view is major-outlet coverage
  // rather than a wall of local rewrites. Falls back to "all" for bills
  // that have no mainstream articles at all, so the section never opens
  // on an empty state.
  const [range, setRange] = useState<"24h" | "week" | "all">("all");
  const [tier, setTier] = useState<"all" | NonNullable<NewsItem["tier"]>>(
    availableTiers.has("mainstream") ? "mainstream" : "all"
  );
  // Free-text outlet search: types 'reuters' → only Reuters items. Applied
  // on top of the tier filter, so "trade" + "politico" narrows further.
  const [outletQuery, setOutletQuery] = useState("");

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = RANGES.find((r) => r.key === range)?.ms ?? null;
    const q = outletQuery.trim().toLowerCase();
    return newsItems.filter((n) => {
      if (tier !== "all" && n.tier !== tier) return false;
      if (cutoff !== null) {
        if (!n.publishedAt) return false;
        const t = Date.parse(n.publishedAt);
        if (Number.isNaN(t) || now - t > cutoff) return false;
      }
      if (q && !n.source.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [newsItems, range, tier, outletQuery]);

  return (
    <div className="card" id="section-news">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
        <div>
          <h2 className="section-title">Related news coverage</h2>
          <p className="settings-desc" style={{ marginTop: 3 }}>
            Real articles mentioning this bill, linked directly. Similar stories are grouped so one event is one entry.
          </p>
        </div>
        <input
          type="search"
          value={outletQuery}
          onChange={(e) => setOutletQuery(e.target.value)}
          placeholder="Filter by outlet…"
          aria-label="Search news by outlet name"
          style={{
            padding: "7px 12px",
            border: "1px solid var(--border)",
            borderRadius: 999,
            background: "var(--surface-soft)",
            color: "var(--text)",
            fontSize: "0.8rem",
            minWidth: 200,
            fontFamily: "inherit",
          }}
        />
      </div>

      {/* Filter chip row. Inline-styled so this component ships without
          adding to globals.css. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "10px 0 14px" }}>
        <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.68rem", color: "var(--text-soft)", letterSpacing: 1, marginRight: 4 }}>WHEN</span>
        {RANGES.map((r) => (
          <FilterChip key={r.key} active={range === r.key} onClick={() => setRange(r.key)}>{r.label}</FilterChip>
        ))}
        {availableTiers.size > 1 && (
          <>
            <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.68rem", color: "var(--text-soft)", letterSpacing: 1, margin: "0 4px 0 10px" }}>OUTLET</span>
            <FilterChip active={tier === "all"} onClick={() => setTier("all")}>All</FilterChip>
            {(["wire", "mainstream", "trade", "local"] as const).map((t) =>
              availableTiers.has(t)
                ? <FilterChip key={t} active={tier === t} onClick={() => setTier(t)}>{TIER_LABEL[t]}</FilterChip>
                : null
            )}
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Nothing in that window. Try widening the time range or clearing the outlet filter.
        </p>
      ) : (
        // Bounded scroll area so a bill with a lot of coverage never pushes
        // everything below it off the page. Same fade-at-bottom treatment
        // as the Rural Bill Finder for a visible "there is more" signal.
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: 360,
            overflowY: "auto",
            paddingRight: 4,
            WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%)",
            maskImage: "linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%)",
          }}
        >
          {filtered.map((n, i) => {
            // Prefer the real publisher URL; fall back to Google's link
            // (which still resolves, just via a redirect).
            const href = n.publisherUrl || n.url;
            const favicon = faviconFor(href);
            return (
              <a
                key={i}
                href={href}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "12px 0",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  textDecoration: "none",
                }}
              >
                {favicon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={favicon} alt="" style={{ width: 18, height: 18, borderRadius: 3, flexShrink: 0, marginTop: 3 }} />
                ) : (
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 22, height: 22, borderRadius: 4, flexShrink: 0, marginTop: 1,
                      background: "var(--text-soft)", color: "var(--bg)",
                      fontSize: 9, fontWeight: 700,
                    }}
                  >
                    {initialsFor(n.source)}
                  </span>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text)", lineHeight: 1.35 }}>
                    {n.title}
                  </div>
                  {n.snippet && (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-soft)", marginTop: 3, lineHeight: 1.45 }}>
                      {n.snippet}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, fontSize: "0.7rem", color: "var(--text-soft)" }}>
                    <span style={{ fontWeight: 600 }}>{n.source}</span>
                    {n.tier && n.tier !== "other" && (
                      <span style={{ padding: "1px 7px", borderRadius: 999, background: "var(--surface-soft)", border: "1px solid var(--border)", fontFamily: "var(--font-mono), monospace", fontSize: "0.62rem", color: "var(--text-soft)" }}>
                        {TIER_LABEL[n.tier]}
                      </span>
                    )}
                    {n.publishedAt && <span>{formatDate(n.publishedAt)}</span>}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: "4px 12px",
        borderRadius: 999,
        border: "1px solid " + (active ? "var(--text)" : "var(--border)"),
        background: active ? "var(--text)" : "var(--surface-soft)",
        color: active ? "var(--bg)" : "var(--text-soft)",
        fontSize: "0.75rem",
        fontFamily: "inherit",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

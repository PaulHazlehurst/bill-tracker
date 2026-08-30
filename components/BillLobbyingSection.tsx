"use client";

import { useMemo, useState } from "react";
import { initialsFor } from "@/lib/billMeta";

// Lobbying filings on the bill page.
//
// Two changes since Stage 2:
//   * Two-up grid on wide screens, single column below ~700px. A busy
//     bill can have twenty filings; a vertical list of twenty is a lot
//     of scroll. Side-by-side halves the height.
//   * Search box that filters by CLIENT or REGISTRANT name. If you know
//     you care about "brownstein" or "PhRMA" you can type it and see
//     only that.

type Filing = {
  filingUuid: string;
  filingYear: number;
  filingType: string;
  registrantName: string;
  clientName: string;
  issueDescription: string;
  documentUrl: string;
};

// Three restrained tones drawn from the app's accent, rotated by first
// letter so the same firm always gets the same chip.
const CHIP_TONES = [
  { bg: "color-mix(in srgb, var(--accent) 18%, var(--surface))", fg: "var(--accent)" },
  { bg: "color-mix(in srgb, var(--text) 8%, var(--surface))", fg: "var(--text)" },
  { bg: "var(--surface-soft)", fg: "var(--text-soft)" },
];

function chipToneFor(name: string) {
  const c = (name.trim()[0] ?? "A").toUpperCase().charCodeAt(0);
  return CHIP_TONES[c % CHIP_TONES.length];
}

function quarterOf(filingType: string): string | null {
  const m = filingType.match(/\bQ[1-4]\b|\bMID[- ]?YEAR\b|\bYEAR[- ]?END\b/i);
  return m ? m[0].toUpperCase().replace(/\s/g, "-") : null;
}

export default function BillLobbyingSection({ filings }: { filings: Filing[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filings;
    return filings.filter(
      (f) =>
        f.clientName.toLowerCase().includes(q) ||
        f.registrantName.toLowerCase().includes(q)
    );
  }, [filings, query]);

  return (
    <div className="card" id="section-lobbying">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="section-title">Lobbying activity</h2>
          <p className="settings-desc" style={{ marginTop: 3 }}>
            Filings that mention this bill, via LDA.gov, the official House and Senate lobbying disclosure database.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by client or firm…"
          aria-label="Search lobbying filings by client or firm"
          style={{
            padding: "7px 12px",
            border: "1px solid var(--border)",
            borderRadius: 999,
            background: "var(--surface-soft)",
            color: "var(--text)",
            fontSize: "0.8rem",
            minWidth: 220,
            fontFamily: "inherit",
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 12 }}>
          No filings match “{query}”.{" "}
          <button
            onClick={() => setQuery("")}
            style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: "inherit" }}
          >
            Clear search
          </button>
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 10,
            marginTop: 14,
          }}
        >
          {filtered.map((f) => {
            const tone = chipToneFor(f.clientName);
            const quarter = quarterOf(f.filingType);
            const isOpen = openId === f.filingUuid;
            return (
              <div
                key={f.filingUuid}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 12,
                  background: "var(--surface)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <button
                  onClick={() => setOpenId(isOpen ? null : f.filingUuid)}
                  aria-expanded={isOpen}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    color: "inherit",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      flexShrink: 0,
                      background: tone.bg,
                      color: tone.fg,
                      fontFamily: "var(--font-mono), monospace",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                    }}
                  >
                    {initialsFor(f.clientName)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-display), sans-serif",
                        fontSize: "0.9rem",
                        fontWeight: 700,
                        color: "var(--text)",
                        lineHeight: 1.25,
                        letterSpacing: "-0.01em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {f.clientName}
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: "0.7rem",
                        color: "var(--text-soft)",
                        fontStyle: "italic",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={f.registrantName}
                    >
                      via {f.registrantName}
                    </div>
                    <div style={{ marginTop: 5 }}>
                      <span
                        style={{
                          fontFamily: "var(--font-mono), monospace",
                          padding: "1px 7px",
                          borderRadius: 999,
                          background: "var(--surface-soft)",
                          border: "1px solid var(--border)",
                          fontSize: "0.6rem",
                          letterSpacing: 0.8,
                          color: "var(--text-soft)",
                        }}
                      >
                        {quarter ? `${quarter} ${f.filingYear}` : f.filingYear}
                      </span>
                    </div>
                  </div>
                  <span
                    aria-hidden="true"
                    style={{
                      fontFamily: "var(--font-mono), monospace",
                      fontSize: 12,
                      color: "var(--text-soft)",
                      marginLeft: 4,
                      transition: "transform 0.15s ease",
                      transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                  >
                    ›
                  </span>
                </button>

                {isOpen && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                    <p style={{ fontSize: "0.81rem", lineHeight: 1.5, margin: 0, color: "var(--text)" }}>
                      {f.issueDescription}
                    </p>
                    <a
                      href={f.documentUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: "0.72rem",
                        display: "inline-block",
                        marginTop: 8,
                        color: "var(--accent)",
                        textDecoration: "none",
                        fontWeight: 600,
                      }}
                    >
                      View filing on LDA.gov →
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

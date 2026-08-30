"use client";

import { useState } from "react";
import { formatDate, initialsFor } from "@/lib/billMeta";

// Lobbying filings on the bill page, restyled.
//
// The old section used a hash-of-name palette that produced 8 random hues -
// crimson, teal, violet, olive - none of which matched the rest of the app.
// It looked like a demo, not a designed section. This version uses a small
// palette of three tones drawn from the app's own accent gold, rotated
// deterministically so the same firm always gets the same chip color.
// Typography leans on the fonts already in the stack: display sans for
// firm names, mono for the year and quarter, body italic for the "via"
// registrant line.

type Filing = {
  filingUuid: string;
  filingYear: number;
  filingType: string;
  registrantName: string;
  clientName: string;
  issueDescription: string;
  documentUrl: string;
};

// Three restrained tones. Ordered so consecutive alphabet buckets don't
// collide, and none of them fight the gold accent used elsewhere.
const CHIP_TONES = [
  { bg: "color-mix(in srgb, var(--accent) 18%, var(--surface))", fg: "var(--accent)" },
  { bg: "color-mix(in srgb, var(--text) 8%, var(--surface))", fg: "var(--text)" },
  { bg: "var(--surface-soft)", fg: "var(--text-soft)" },
];

function chipToneFor(name: string) {
  // First letter into three buckets. Deterministic, stable across renders.
  const c = (name.trim()[0] ?? "A").toUpperCase().charCodeAt(0);
  return CHIP_TONES[c % CHIP_TONES.length];
}

// LDA filings often carry a quarter code in the type field ("Q1", "Q2",
// "MID-YEAR"). Pull it out so it can sit as a small mono label rather than
// stuffed into the meta line.
function quarterOf(filingType: string): string | null {
  const m = filingType.match(/\bQ[1-4]\b|\bMID[- ]?YEAR\b|\bYEAR[- ]?END\b/i);
  return m ? m[0].toUpperCase().replace(/\s/g, "-") : null;
}

export default function BillLobbyingSection({ filings }: { filings: Filing[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="card" id="section-lobbying">
      <h2 className="section-title">Lobbying activity</h2>
      <p className="settings-desc" style={{ marginTop: 3 }}>
        Filings that mention this bill, via LDA.gov, the official House and Senate lobbying disclosure database. Best-effort text match, not exhaustive.
      </p>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
        {filings.map((f, i) => {
          const tone = chipToneFor(f.clientName);
          const quarter = quarterOf(f.filingType);
          const isOpen = openId === f.filingUuid;
          return (
            <div
              key={f.filingUuid}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "12px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <button
                onClick={() => setOpenId(isOpen ? null : f.filingUuid)}
                aria-expanded={isOpen}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
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
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    flexShrink: 0,
                    background: tone.bg,
                    color: tone.fg,
                    fontFamily: "var(--font-mono), monospace",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    marginTop: 1,
                  }}
                >
                  {initialsFor(f.clientName)}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: "block",
                      fontFamily: "var(--font-display), sans-serif",
                      fontSize: "0.95rem",
                      fontWeight: 700,
                      color: "var(--text)",
                      lineHeight: 1.3,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {f.clientName}
                  </span>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 8,
                      marginTop: 4,
                      fontSize: "0.72rem",
                      color: "var(--text-soft)",
                    }}
                  >
                    <span style={{ fontStyle: "italic" }}>via {f.registrantName}</span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono), monospace",
                        padding: "1px 7px",
                        borderRadius: 999,
                        background: "var(--surface-soft)",
                        border: "1px solid var(--border)",
                        fontSize: "0.62rem",
                        letterSpacing: 0.8,
                      }}
                    >
                      {quarter ? `${quarter} ${f.filingYear}` : f.filingYear}
                    </span>
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    fontFamily: "var(--font-mono), monospace",
                    fontSize: 12,
                    color: "var(--text-soft)",
                    marginTop: 6,
                    marginLeft: 8,
                    transition: "transform 0.15s ease",
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                  }}
                >
                  ›
                </span>
              </button>

              {isOpen && (
                <div style={{ marginTop: 10, paddingLeft: 46 }}>
                  <p style={{ fontSize: "0.83rem", lineHeight: 1.5, margin: 0, color: "var(--text)" }}>
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
    </div>
  );
}

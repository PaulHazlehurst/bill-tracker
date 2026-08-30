"use client";

import { useState } from "react";
import { formatDate } from "@/lib/billMeta";
import { ScrollText, ExternalLink } from "lucide-react";

// Congressional Record mentions with per-item "Read more" expansion.
//
// GovInfo's response often includes a short excerpt (teaser / summary /
// excerpts.excerpts[]). Where it does, "Read more" reveals it inline so
// you can decide whether the mention is worth clicking through to
// govinfo.gov for the full floor speech. Where GovInfo returns no
// excerpt, the expansion honestly says so and offers the direct link.

type Mention = {
  title: string;
  date: string | null;
  section: string | null;
  url: string | null;
  snippet?: string | null;
};

export default function BillRecordSection({ mentions }: { mentions: Mention[] }) {
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <div className="card" id="section-record">
      <h2 className="section-title">Congressional Record mentions</h2>
      <p className="settings-desc" style={{ marginTop: 3 }}>
        Floor speeches and remarks that mention this bill, straight from the official record. Best-effort search, may not be exhaustive.
      </p>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
        {mentions.map((m, i) => {
          const isOpen = openId === i;
          const canExpand = !!m.snippet;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "12px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
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
                    background: "color-mix(in srgb, var(--text) 8%, var(--surface))",
                    color: "var(--text)",
                    marginTop: 1,
                  }}
                >
                  <ScrollText size={16} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-display), sans-serif",
                      fontSize: "0.9rem",
                      fontWeight: 700,
                      color: "var(--text)",
                      lineHeight: 1.35,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {m.title}
                  </div>
                  <div
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
                    <span style={{ fontStyle: "italic" }}>{m.section ?? "Congressional Record"}</span>
                    {m.date && (
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
                        {formatDate(m.date)}
                      </span>
                    )}
                    <button
                      onClick={() => setOpenId(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "var(--accent)",
                        fontFamily: "inherit",
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {isOpen ? "Show less" : "Read more"}
                    </button>
                  </div>

                  {isOpen && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "10px 12px",
                        background: "var(--surface-soft)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                      }}
                    >
                      {canExpand ? (
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "var(--font-official), Georgia, serif",
                            fontSize: "0.86rem",
                            lineHeight: 1.55,
                            color: "var(--text)",
                          }}
                        >
                          {m.snippet}
                        </p>
                      ) : (
                        <p
                          className="muted"
                          style={{ margin: 0, fontSize: "0.8rem" }}
                        >
                          No excerpt was returned for this mention. Open the full record on GovInfo below.
                        </p>
                      )}
                      {m.url && (
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            marginTop: 8,
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            color: "var(--accent)",
                            textDecoration: "none",
                          }}
                        >
                          Full record on GovInfo <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

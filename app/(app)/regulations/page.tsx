"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import EmptyState from "@/components/EmptyState";
import { useUI } from "@/components/UIProvider";
import { Landmark, AlertTriangle, ExternalLink, X } from "lucide-react";
import { formatDate } from "@/lib/billMeta";

// The /regulations page. Companion to the dashboard: dashboard shows bills
// matching your topics, this shows federal rulemaking matching them.
// Reads from prospective_regulations (RLS-scoped) and its joined regulations
// cache. Everything is filled in by the daily notify-cron discovery pass;
// this page never touches the Federal Register API directly.

type DocType = "proposed" | "final" | "notice" | "other";

type Reg = {
  id: string;
  title: string;
  abstract: string | null;
  doc_type: DocType;
  docket_id: string | null;
  agencies: string[];
  publication_date: string;
  comment_close_date: string | null;
  effective_date: string | null;
  html_url: string | null;
};

type Row = {
  id: string;                 // prospective_regulations.id
  regulation_id: string;
  matched_topic: string;
  discovered_at: string;
  regulations: Reg | Reg[] | null;
};

const TYPE_LABEL: Record<DocType, string> = {
  proposed: "Proposed rule",
  final:    "Final rule",
  notice:   "Notice",
  other:    "Other",
};

const TYPE_TONE: Record<DocType, { bg: string; fg: string }> = {
  proposed: { bg: "color-mix(in srgb, var(--accent) 18%, var(--surface))", fg: "var(--accent)" },
  final:    { bg: "color-mix(in srgb, var(--pos-support) 20%, var(--surface))", fg: "var(--pos-support)" },
  notice:   { bg: "color-mix(in srgb, var(--text) 8%, var(--surface))",    fg: "var(--text)" },
  other:    { bg: "var(--surface-soft)",                                    fg: "var(--text-soft)" },
};

function daysUntil(iso: string): number {
  const days = Math.floor((Date.parse(iso) - Date.now()) / 86400_000);
  return days;
}

export default function RegulationsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useUI();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | DocType>("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const res = await fetch("/api/regulations");
      const body = await res.json();
      if (body.error) setError(body.error);
      setRows(body.regulations ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flat = useMemo(() => {
    return rows
      .map((row) => {
        const r = Array.isArray(row.regulations) ? row.regulations[0] : row.regulations;
        if (!r) return null;
        return { prospectiveId: row.id, matchedTopic: row.matched_topic, discoveredAt: row.discovered_at, reg: r };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [rows]);

  const topics = useMemo(() => {
    const s = new Set(flat.map((f) => f.matchedTopic));
    return Array.from(s).sort();
  }, [flat]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flat.filter((f) => {
      if (typeFilter !== "all" && f.reg.doc_type !== typeFilter) return false;
      if (topicFilter !== "all" && f.matchedTopic !== topicFilter) return false;
      if (q) {
        const hay = (f.reg.title + " " + (f.reg.abstract ?? "") + " " + f.reg.agencies.join(" ")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [flat, typeFilter, topicFilter, search]);

  // Sort: open comment periods first (soonest deadline), then everything
  // else by publication date descending. Puts anything time-sensitive at
  // the top of the page.
  const sorted = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const open = filtered.filter((f) => f.reg.comment_close_date && f.reg.comment_close_date >= today);
    const closed = filtered.filter((f) => !(f.reg.comment_close_date && f.reg.comment_close_date >= today));
    open.sort((a, b) => (a.reg.comment_close_date ?? "").localeCompare(b.reg.comment_close_date ?? ""));
    closed.sort((a, b) => b.reg.publication_date.localeCompare(a.reg.publication_date));
    return [...open, ...closed];
  }, [filtered]);

  async function dismiss(prospectiveId: string) {
    setDismissingId(prospectiveId);
    const res = await fetch("/api/regulations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: prospectiveId }),
    });
    setDismissingId(null);
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.id !== prospectiveId));
    } else {
      toast("Couldn't dismiss that one. Try again.", "error");
    }
  }

  if (loading) return <Spinner label="Loading regulations…" large />;

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Federal Register</span>
          <h1>Regulations</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Proposed rules, final rules, and notices from federal agencies that match your topics. Refreshed daily from federalregister.gov.
          </p>
        </div>
      </div>

      {error && <p className="error-text">Couldn't load: {error}</p>}

      {flat.length === 0 ? (
        <EmptyState icon={Landmark}>
          Nothing matched your topics yet. New rules appear here automatically the day after they publish.
        </EmptyState>
      ) : (
        <>
          {/* Filter row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "18px 0 8px" }}>
            <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.68rem", color: "var(--text-soft)", letterSpacing: 1 }}>TYPE</span>
            {(["all", "proposed", "final", "notice"] as const).map((t) => (
              <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
                {t === "all" ? "All" : TYPE_LABEL[t as DocType]}
              </FilterChip>
            ))}
            {topics.length > 1 && (
              <>
                <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.68rem", color: "var(--text-soft)", letterSpacing: 1, marginLeft: 10 }}>TOPIC</span>
                <select
                  value={topicFilter}
                  onChange={(e) => setTopicFilter(e.target.value)}
                  className="toolbar-select"
                  style={{ fontSize: "0.78rem" }}
                >
                  <option value="all">All topics</option>
                  {topics.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </>
            )}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by title, agency, or abstract…"
              aria-label="Search regulations"
              style={{
                marginLeft: "auto",
                padding: "7px 12px",
                border: "1px solid var(--border)",
                borderRadius: 999,
                background: "var(--surface-soft)",
                color: "var(--text)",
                fontSize: "0.8rem",
                minWidth: 260,
                fontFamily: "inherit",
              }}
            />
          </div>

          <p className="muted" style={{ fontSize: "0.75rem", marginBottom: 14 }}>
            {sorted.length} matched {sorted.length === 1 ? "regulation" : "regulations"}.
            {" "}Open comment periods listed first.
          </p>

          <div style={{ display: "grid", gap: 12 }}>
            {sorted.map((f) => (
              <RegCard key={f.prospectiveId} f={f} onDismiss={() => dismiss(f.prospectiveId)} dismissing={dismissingId === f.prospectiveId} />
            ))}
          </div>
        </>
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

function RegCard({ f, onDismiss, dismissing }: {
  f: { prospectiveId: string; matchedTopic: string; discoveredAt: string; reg: Reg };
  onDismiss: () => void;
  dismissing: boolean;
}) {
  const tone = TYPE_TONE[f.reg.doc_type];
  const today = new Date().toISOString().slice(0, 10);
  const commentOpen = f.reg.comment_close_date && f.reg.comment_close_date >= today;
  const commentDays = commentOpen ? daysUntil(f.reg.comment_close_date!) : null;
  const isUrgent = commentDays !== null && commentDays <= 7;
  const agency = f.reg.agencies[0] ?? "Federal agency";

  return (
    <div
      style={{
        border: "1px solid " + (isUrgent ? "color-mix(in srgb, var(--pos-oppose) 40%, var(--border))" : "var(--border)"),
        borderRadius: 12,
        padding: 16,
        background: "var(--surface)",
        boxShadow: "var(--shadow-elevated)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          style={{
            padding: "3px 10px",
            borderRadius: 999,
            background: tone.bg,
            color: tone.fg,
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: 0.5,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {TYPE_LABEL[f.reg.doc_type]}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--font-display), sans-serif",
              fontSize: "1.05rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.3,
              color: "var(--text)",
            }}
          >
            {f.reg.html_url ? (
              <a href={f.reg.html_url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                {f.reg.title}
              </a>
            ) : f.reg.title}
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6, fontSize: "0.72rem", color: "var(--text-soft)" }}>
            <span style={{ fontStyle: "italic" }}>{agency}</span>
            <span style={{ fontFamily: "var(--font-mono), monospace", padding: "1px 7px", borderRadius: 999, background: "var(--surface-soft)", border: "1px solid var(--border)", fontSize: "0.62rem", letterSpacing: 0.8 }}>
              Published {formatDate(f.reg.publication_date)}
            </span>
            <span style={{ padding: "1px 8px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600, fontSize: "0.65rem" }}>
              matched: {f.matchedTopic}
            </span>
          </div>
        </div>
        <button
          onClick={onDismiss}
          disabled={dismissing}
          aria-label="Dismiss this regulation"
          title="Not interested"
          style={{
            background: "none",
            border: "none",
            padding: 4,
            color: "var(--text-soft)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {f.reg.abstract && (
        <p style={{ fontSize: "0.86rem", lineHeight: 1.5, color: "var(--text)", marginTop: 12, marginBottom: 0 }}>
          {f.reg.abstract.length > 340 ? f.reg.abstract.slice(0, 337).trimEnd() + "…" : f.reg.abstract}
        </p>
      )}

      {(commentOpen || f.reg.effective_date) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: "0.78rem" }}>
          {commentOpen && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: isUrgent ? "var(--pos-oppose)" : "var(--text-soft)", fontWeight: isUrgent ? 600 : 400 }}>
              {isUrgent && <AlertTriangle size={13} />}
              Comments close {formatDate(f.reg.comment_close_date!)}
              {commentDays !== null && commentDays >= 0 && (
                <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.72rem" }}>
                  ({commentDays === 0 ? "today" : commentDays === 1 ? "tomorrow" : `${commentDays} days`})
                </span>
              )}
            </span>
          )}
          {f.reg.effective_date && (
            <span style={{ color: "var(--text-soft)" }}>
              Effective {formatDate(f.reg.effective_date)}
            </span>
          )}
          {f.reg.html_url && (
            <a
              href={f.reg.html_url}
              target="_blank"
              rel="noreferrer"
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
            >
              Full text on federalregister.gov <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

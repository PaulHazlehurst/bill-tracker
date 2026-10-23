"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import EmptyState from "@/components/EmptyState";
import { useUI } from "@/components/UIProvider";
import { Landmark, AlertTriangle, ExternalLink, X, Search } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
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


function daysUntil(iso: string): number {
  // Whole calendar days, read as local dates (Federal Register dates are bare days).
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
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

  const openCount = flat.filter((f) => f.reg.comment_close_date && f.reg.comment_close_date >= new Date().toISOString().slice(0, 10)).length;

  return (
    <div className="page">
      <PageHeader
        title="Regulations"
        description="Proposed rules, final rules and notices from federal agencies that match your topics, checked daily against federalregister.gov."
      />

      {loading ? (
        <div className="list-skel">{[0, 1, 2].map((i) => <div key={i} className="skel skel-billrow" />)}</div>
      ) : (
        <>
          {error && <p className="error-text">Couldn't load regulations: {error}</p>}
          {flat.length === 0 ? (
            <EmptyState icon={Landmark} title="No matching regulations yet">
              New rules that match your Discover topics appear here the day after they're published.
            </EmptyState>
          ) : (
            <>
              <div className="toolbar">
                <div className="chips" role="group" aria-label="Document type">
                  {(["all", "proposed", "final", "notice"] as const).map((t) => (
                    <button key={t} className={`chip${typeFilter === t ? " is-on" : ""}`} onClick={() => setTypeFilter(t)} aria-pressed={typeFilter === t}>
                      {t === "all" ? "All types" : TYPE_LABEL[t as DocType]}
                    </button>
                  ))}
                </div>
                {topics.length > 1 && (
                  <select value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)} className="select" aria-label="Topic">
                    <option value="all">All topics</option>
                    {topics.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                <label className="search-field">
                  <Search size={15} aria-hidden="true" />
                  <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, agency, or summary" aria-label="Filter regulations" />
                </label>
              </div>
              <p className="result-count">
                {sorted.length} regulation{sorted.length === 1 ? "" : "s"}{openCount > 0 ? `, ${openCount} with comment periods still open (listed first)` : ""}.
              </p>
              <ul className="regs">
                {sorted.map((f) => (
                  <RegCard key={f.prospectiveId} f={f} onDismiss={() => dismiss(f.prospectiveId)} dismissing={dismissingId === f.prospectiveId} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function RegCard({ f, onDismiss, dismissing }: {
  f: { prospectiveId: string; matchedTopic: string; discoveredAt: string; reg: Reg };
  onDismiss: () => void;
  dismissing: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const commentOpen = !!f.reg.comment_close_date && f.reg.comment_close_date >= today;
  const commentDays = commentOpen ? daysUntil(f.reg.comment_close_date!) : null;
  const isUrgent = commentDays !== null && commentDays <= 7;
  const agency = f.reg.agencies[0] ?? "Federal agency";

  return (
    <li className={`reg${isUrgent ? " is-urgent" : ""}`}>
      <div className="reg-top">
        <span className={`reg-type reg-${f.reg.doc_type}`}>{TYPE_LABEL[f.reg.doc_type]}</span>
        <span className="reg-agency">{agency}</span>
        <span className="sugg-topic">{f.matchedTopic}</span>
        <button className="icon-btn reg-x" onClick={onDismiss} disabled={dismissing} aria-label="Not interested in this regulation" title="Not interested"><X size={15} /></button>
      </div>
      <h3 className="reg-title">
        {f.reg.html_url ? <a href={f.reg.html_url} target="_blank" rel="noreferrer">{f.reg.title}</a> : f.reg.title}
      </h3>
      {f.reg.abstract && <p className="reg-abstract">{f.reg.abstract.length > 340 ? f.reg.abstract.slice(0, 337).trimEnd() + "…" : f.reg.abstract}</p>}
      <div className="reg-foot">
        <span>Published {formatDate(f.reg.publication_date)}</span>
        {commentOpen && (
          <span className={isUrgent ? "reg-urgent" : "reg-open"}>
            {isUrgent && <AlertTriangle size={13} />}
            Comments close {formatDate(f.reg.comment_close_date!)} ({commentDays === 0 ? "today" : commentDays === 1 ? "tomorrow" : `in ${commentDays} days`})
          </span>
        )}
        {f.reg.effective_date && <span>Takes effect {formatDate(f.reg.effective_date)}</span>}
        {f.reg.html_url && (
          <a href={f.reg.html_url} target="_blank" rel="noreferrer" className="reg-link">Read on federalregister.gov <ExternalLink size={12} /></a>
        )}
      </div>
    </li>
  );
}

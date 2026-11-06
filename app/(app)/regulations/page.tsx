"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import EmptyState from "@/components/EmptyState";
import { useUI } from "@/components/UIProvider";
import { Landmark, ExternalLink, X, Search, MessageSquareText } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { formatDate } from "@/lib/billMeta";
import { displayName } from "@/lib/team";
import { optimistic, restoreItems } from "@/lib/motion";
import { MotionItem } from "@/components/Motion";
import {
  commentOpen,
  daysBetween,
  DOC_TYPE_LABELS,
  localToday,
  REG_STATUS_LABELS,
  REG_STATUSES,
  regulationsGovUrl,
  SECTION_LABELS,
  sectionFor,
  sortForSection,
  whenText,
  type DocType,
  type RegStatus,
  type Section,
} from "@/lib/regulations";

// Federal rules that match your topics, organised around what you can do
// about them: comment while the period is open, follow as a team, and know
// when final rules take effect. Filled in by the morning discovery run; this
// page never calls the Federal Register itself.

type Reg = {
  id: string;
  title: string;
  abstract: string | null;
  doc_type: DocType;
  docket_id: string | null;
  agencies: (string | { name?: string })[] | null;
  publication_date: string;
  comment_close_date: string | null;
  effective_date: string | null;
  html_url: string | null;
};

type Row = {
  id: string;
  regulation_id: string;
  matched_topic: string;
  discovered_at: string;
  regulations: Reg | Reg[] | null;
  status?: RegStatus;
  status_at?: string | null;
  status_by_profile?: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
};

type Item = {
  id: string;
  regId: string;
  topic: string;
  discoveredAt: string;
  status: RegStatus;
  statusAt: string | null;
  statusBy: string | null;
  agency: string;
  reg: Reg;
};

type View = "all" | "open" | "following" | "new";
const SECTIONS: Section[] = ["open", "final", "other"];

function agencyName(a: Reg["agencies"]): string {
  const first = Array.isArray(a) ? a[0] : null;
  return (typeof first === "string" ? first : first?.name) || "Federal agency";
}

function toItem(row: Row): Item | null {
  const reg = Array.isArray(row.regulations) ? row.regulations[0] : row.regulations;
  if (!reg) return null;
  const by = Array.isArray(row.status_by_profile) ? row.status_by_profile[0] : row.status_by_profile;
  return {
    id: row.id,
    regId: row.regulation_id,
    topic: row.matched_topic,
    discoveredAt: row.discovered_at,
    status: row.status ?? "new",
    statusAt: row.status_at ?? null,
    statusBy: by ? displayName(by) : null,
    agency: agencyName(reg.agencies),
    reg,
  };
}

export default function RegulationsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useUI();
  const today = localToday();

  const [rows, setRows] = useState<Row[]>([]);
  const [statusReady, setStatusReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("all");
  const [agency, setAgency] = useState("all");
  const [topic, setTopic] = useState("all");
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const res = await fetch("/api/regulations");
      const body = await res.json().catch(() => ({ error: "Couldn't read regulations." }));
      if (body.error) setError(body.error);
      setRows(body.regulations ?? []);
      setStatusReady(body.statusReady !== false);
      setLoading(false);
      setFocus(new URLSearchParams(window.location.search).get("focus"));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opened from a deadline reminder: bring that regulation into view.
  useEffect(() => {
    if (!focus || loading) return;
    const item = rows.find((r) => r.regulation_id === focus);
    if (item) requestAnimationFrame(() => document.getElementById(`reg-${item.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [focus, loading, rows]);

  const items = useMemo(() => rows.map(toItem).filter((x): x is Item => !!x), [rows]);
  const agencies = useMemo(() => Array.from(new Set(items.map((i) => i.agency))).sort(), [items]);
  const topics = useMemo(() => Array.from(new Set(items.map((i) => i.topic))).sort(), [items]);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const isNew = (i: Item) => i.discoveredAt >= weekAgo && i.status === "new";

  const counts = {
    open: items.filter((i) => commentOpen(i.reg.comment_close_date, today)).length,
    following: items.filter((i) => i.status !== "new").length,
    new: items.filter(isNew).length,
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (view === "open" && !commentOpen(i.reg.comment_close_date, today)) return false;
      if (view === "following" && i.status === "new") return false;
      if (view === "new" && !isNew(i)) return false;
      if (agency !== "all" && i.agency !== agency) return false;
      if (topic !== "all" && i.topic !== topic) return false;
      if (q && !`${i.reg.title} ${i.reg.abstract ?? ""} ${i.agency} ${i.reg.docket_id ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, view, agency, topic, search, today]);

  const sections = SECTIONS.map((s) => ({ s, items: sortForSection(filtered.filter((i) => sectionFor(i.reg, today) === s), s, today) })).filter((x) => x.items.length);
  const deadlines = sortForSection(items.filter((i) => commentOpen(i.reg.comment_close_date, today)), "open", today).slice(0, 6);

  const patch = (id: string, body: Record<string, unknown>) =>
    fetch("/api/regulations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) }).then((r) => {
      if (!r.ok) throw new Error();
      return r;
    });

  async function setStatus(item: Item, status: RegStatus) {
    const before = rows;
    await optimistic({
      apply: () => setRows((prev) => prev.map((r) => (r.id === item.id ? { ...r, status, status_at: new Date().toISOString(), status_by_profile: { full_name: "You", email: null } } : r))),
      revert: () => setRows(before),
      save: () => patch(item.id, { status }),
      onError: () => toast("Couldn't save that. Try again.", "error"),
    });
  }

  async function dismiss(id: string) {
    const before = rows;
    const ok = await optimistic({
      apply: () => setRows((prev) => prev.filter((r) => r.id !== id)),
      revert: () => setRows(before),
      save: () => patch(id, { dismissed: true }),
      onError: () => toast("Couldn't hide that one. Try again.", "error"),
    });
    if (ok)
      toast("Hidden for your team", "info", {
        action: {
          label: "Undo",
          run: () =>
            optimistic({
              apply: () => setRows((prev) => restoreItems(prev, before, [id])),
              revert: () => setRows((prev) => prev.filter((r) => r.id !== id)),
              save: () => patch(id, { dismissed: false }),
              onError: () => toast("Couldn't bring it back. Refresh to try again.", "error"),
            }),
        },
      });
  }

  return (
    <div className="page container-wide">
      <PageHeader
        title="Regulations"
        description="Federal rules and notices that match your topics, checked each morning against the Federal Register. Comment while a period is open, and follow the ones that matter as a team."
      />

      {loading ? (
        <div className="list-skel">{[0, 1, 2].map((i) => <div key={i} className="skel skel-billrow" />)}</div>
      ) : (
        <div className="settle">
          {error && <p className="error-text">{error}</p>}
          {!statusReady && (
            <p className="rg-notice">Following regulations as a team needs database update 0008. Until it's run, you can read and hide regulations but not follow them.</p>
          )}
          {items.length === 0 ? (
            <EmptyState icon={Landmark} title="No matching regulations yet">
              Rules that match your team's topics appear here the morning after they're published. Add or sharpen topics in Settings.
            </EmptyState>
          ) : (
            <>
              {deadlines.length > 0 && (
                <section className="rg-deadlines" aria-labelledby="rg-dl-title">
                  <h2 id="rg-dl-title" className="rg-h2">Comment deadlines</h2>
                  <ol className="rg-dl">
                    {deadlines.map((i) => {
                      const days = daysBetween(today, i.reg.comment_close_date!);
                      return (
                        <li key={i.id}>
                          <a href={`#reg-${i.id}`} className={`rg-dl-tile${days <= 7 ? " is-soon" : ""}`} onClick={() => setFocus(i.regId)}>
                            <span className="rg-dl-days">
                              <strong>{Math.max(days, 0)}</strong> {days === 1 ? "day" : "days"}
                            </span>
                            <span className="rg-dl-title">{i.reg.title}</span>
                            <span className="rg-dl-meta">
                              {i.agency}
                              {i.status !== "new" && <> · {REG_STATUS_LABELS[i.status]}</>}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}

              <div className="toolbar rg-toolbar">
                <div className="seg" role="group" aria-label="Show">
                  {([
                    ["all", `All ${items.length}`],
                    ["open", `Open for comment ${counts.open}`],
                    ["following", `Following ${counts.following}`],
                    ["new", `New this week ${counts.new}`],
                  ] as [View, string][]).map(([v, label]) => (
                    <button key={v} className={view === v ? "is-on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
                      {label}
                    </button>
                  ))}
                </div>
                {agencies.length > 1 && (
                  <select value={agency} onChange={(e) => setAgency(e.target.value)} className="select" aria-label="Agency">
                    <option value="all">All agencies</option>
                    {agencies.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
                {topics.length > 1 && (
                  <select value={topic} onChange={(e) => setTopic(e.target.value)} className="select" aria-label="Topic">
                    <option value="all">All topics</option>
                    {topics.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                <label className="search-field">
                  <Search size={15} aria-hidden="true" />
                  <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, agency, summary or docket" aria-label="Filter regulations" />
                </label>
              </div>

              {sections.length === 0 ? (
                <p className="result-count">Nothing matches these filters.</p>
              ) : (
                sections.map(({ s, items: list }) => (
                  <section key={s} className="rg-section" aria-labelledby={`rg-${s}`}>
                    <div className="rg-section-head">
                      <h2 id={`rg-${s}`} className="rg-h2">{SECTION_LABELS[s].title} <span className="rg-count">{list.length}</span></h2>
                      <p className="rg-section-desc">{SECTION_LABELS[s].desc}</p>
                    </div>
                    <ul className="regs">
                      {list.map((i) => (
                        <MotionItem key={i.id}>
                          <RegCard
                            item={i}
                            today={today}
                            isNew={isNew(i)}
                            focused={focus === i.regId}
                            canFollow={statusReady}
                            onStatus={(st) => setStatus(i, st)}
                            onDismiss={() => dismiss(i.id)}
                          />
                        </MotionItem>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RegCard({ item: i, today, isNew, focused, canFollow, onStatus, onDismiss }: {
  item: Item;
  today: string;
  isNew: boolean;
  focused: boolean;
  canFollow: boolean;
  onStatus: (s: RegStatus) => void;
  onDismiss: () => void;
}) {
  const open = commentOpen(i.reg.comment_close_date, today);
  const days = open ? daysBetween(today, i.reg.comment_close_date!) : null;
  const soon = days !== null && days <= 7;
  const commentUrl = open ? regulationsGovUrl(i.reg.docket_id) : null;
  const effectiveAhead = !!i.reg.effective_date && i.reg.effective_date >= today;

  return (
    <li id={`reg-${i.id}`} className={`reg rg-card${soon ? " is-urgent" : ""}${focused ? " is-focused" : ""}${i.status !== "new" ? ` is-${i.status}` : ""}`}>
      <div className="reg-top">
        <span className={`reg-type reg-${i.reg.doc_type}`}>{DOC_TYPE_LABELS[i.reg.doc_type] ?? "Document"}</span>
        <span className="reg-agency">{i.agency}</span>
        <span className="sugg-topic">{i.topic}</span>
        {isNew && <span className="rg-new">New</span>}
        <button className="icon-btn reg-x" onClick={onDismiss} aria-label={`Hide "${i.reg.title}" for your team`} title="Not relevant: hide for your team"><X size={15} /></button>
      </div>
      <h3 className="reg-title">
        {i.reg.html_url ? <a href={i.reg.html_url} target="_blank" rel="noreferrer">{i.reg.title}</a> : i.reg.title}
      </h3>
      {i.reg.abstract && <p className="reg-abstract">{i.reg.abstract.length > 340 ? `${i.reg.abstract.slice(0, 337).trimEnd()}…` : i.reg.abstract}</p>}

      <dl className="rg-dates">
        {open && (
          <div className={soon ? "is-soon" : ""}>
            <dt>Comments close</dt>
            <dd>{formatDate(i.reg.comment_close_date!)} ({whenText(days!)})</dd>
          </div>
        )}
        {i.reg.effective_date && (
          <div>
            <dt>{effectiveAhead ? "Takes effect" : "In effect since"}</dt>
            <dd>{formatDate(i.reg.effective_date)}</dd>
          </div>
        )}
        <div>
          <dt>Published</dt>
          <dd>{formatDate(i.reg.publication_date)}</dd>
        </div>
        {i.reg.docket_id && (
          <div>
            <dt>Docket</dt>
            <dd className="rg-mono">{i.reg.docket_id}</dd>
          </div>
        )}
      </dl>

      <div className="rg-actions">
        {canFollow && (
          <label className="rg-status">
            <span className="sr-only">Your team's status</span>
            <select value={i.status} onChange={(e) => onStatus(e.target.value as RegStatus)} className={`select rg-status-select is-${i.status}`}>
              {REG_STATUSES.map((s) => <option key={s} value={s}>{REG_STATUS_LABELS[s]}</option>)}
            </select>
          </label>
        )}
        {i.status !== "new" && i.statusBy && (
          <span className="rg-who">Set by {i.statusBy}{i.statusAt ? `, ${formatDate(i.statusAt)}` : ""}</span>
        )}
        <span className="rg-spacer" />
        {commentUrl && (
          <a href={commentUrl} target="_blank" rel="noreferrer" className="btn btn-sm rg-comment">
            <MessageSquareText size={14} aria-hidden="true" /> Comment on regulations.gov
          </a>
        )}
        {i.reg.html_url && (
          <a href={i.reg.html_url} target="_blank" rel="noreferrer" className="reg-link">Read the document <ExternalLink size={12} aria-hidden="true" /></a>
        )}
      </div>
    </li>
  );
}

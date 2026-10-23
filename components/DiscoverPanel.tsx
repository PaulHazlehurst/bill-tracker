"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUI } from "@/components/UIProvider";
import { useSession } from "@/components/SessionProvider";
import { citationFor } from "@/lib/billMeta";
import { Plus, X, RefreshCw, Eye, Sparkles } from "lucide-react";

type Suggestion = {
  id: string;
  bill_id: string;
  matched_topic: string;
  discovered_at: string;
  match_reason?: string | null;
  bills: { title: string; status_stage: string; latest_action_date: string | null } | { title: string; status_stage: string; latest_action_date: string | null }[] | null;
};

type TopicReport = { topic: string; found: number; alreadyTracked: number; alreadySuggested: number; added: number; failed: boolean };
type PreviewBill = { id: string; title: string; reasons?: string[]; status: "tracked" | "suggested" | "new" };

// Topic-based discovery, living on the dashboard. You name the issues you
// care about; every morning (or right now, with "Check now") we look across
// the full text of every bill in Congress and suggest ones you aren't
// tracking yet, each with the reason it matched.
export default function DiscoverPanel({ onTracked }: { onTracked: () => void }) {
  const supabase = createClient();
  const { toast } = useUI();
  const { userId, profile, effectiveTopics, loading: sessionLoading, refresh } = useSession();
  const orgId = profile?.organization_id ?? null;

  const [topics, setTopics] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<{ added: number; topics: TopicReport[]; message?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ topic: string; bills: PreviewBill[]; loading: boolean; error?: string } | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => setTopics(effectiveTopics), [effectiveTopics.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadSuggestions(); }, []);

  async function loadSuggestions() {
    const res = await fetch("/api/prospective").catch(() => null);
    const body = res && res.ok ? await res.json() : { prospective: [] };
    setItems(body.prospective ?? []);
  }

  async function saveTopics(next: string[]) {
    if (!userId) return false;
    const previous = topics;
    setTopics(next);
    const { error } = await supabase.from(orgId ? "organizations" : "profiles").update({ topics: next }).eq("id", orgId ?? userId);
    if (error) {
      setTopics(previous);
      toast(`Couldn't save topics: ${error.message}`, "error");
      return false;
    }
    refresh();
    return true;
  }

  async function addTopic(t: string) {
    const topic = t.trim();
    if (!topic) return;
    if (topics.some((x) => x.toLowerCase() === topic.toLowerCase())) {
      toast(`“${topic}” is already one of your topics.`, "info");
      return;
    }
    if (await saveTopics([...topics, topic])) {
      setDraft("");
      setPreview(null);
      toast(`Watching “${topic}”. Checking for bills now…`, "success");
      checkNow();
    }
  }

  async function runPreview() {
    const topic = draft.trim();
    if (topic.length < 2) return;
    setPreview({ topic, bills: [], loading: true });
    const res = await fetch(`/api/prospective/preview?topic=${encodeURIComponent(topic)}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) setPreview({ topic, bills: [], loading: false, error: body.error ?? "Preview is unavailable right now." });
    else setPreview({ topic, bills: body.bills ?? [], loading: false });
  }

  async function checkNow() {
    setChecking(true);
    setReport(null);
    try {
      const res = await fetch("/api/prospective/discover-now", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setReport({ added: 0, topics: [], message: "The check didn't finish. Try again in a minute." });
      else if (body.reason === "no topics configured") setReport({ added: 0, topics: [], message: "Add a topic first." });
      else if (body.searchFailed) setReport({ added: 0, topics: body.topics ?? [], message: "Couldn't reach the bill search services just now. Try again shortly." });
      else setReport({ added: body.added ?? 0, topics: body.topics ?? [] });
      if ((body.added ?? 0) > 0) loadSuggestions();
    } catch {
      setReport({ added: 0, topics: [], message: "Couldn't reach the server. Try again in a moment." });
    } finally {
      setChecking(false);
    }
  }

  async function track(item: Suggestion) {
    const [billType, billNumber, congress] = item.bill_id.split("-");
    setBusy(item.id);
    try {
      const res = await fetch("/api/bills/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ congress: Number(congress), billType, billNumber: Number(billNumber) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? "Couldn't track that bill.", "error");
        return;
      }
      setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
      toast(`Tracking ${citationFor(item.bill_id)}`, "success");
      onTracked();
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(ids: string[]) {
    setItems((prev) => (prev ?? []).filter((i) => !ids.includes(i.id)));
    const res = await fetch("/api/prospective", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    if (!res.ok) {
      toast("Couldn't dismiss that. Try again.", "error");
      loadSuggestions();
    }
  }

  const counts: Record<string, number> = {};
  for (const i of items ?? []) counts[i.matched_topic] = (counts[i.matched_topic] ?? 0) + 1;
  const visible = (items ?? []).filter((i) => !filter || i.matched_topic === filter);

  if (sessionLoading) return <section className="panel discover"><div className="skel skel-block" /></section>;

  return (
    <section className="panel discover" aria-labelledby="discover-title">
      <div className="panel-head">
        <div>
          <h2 id="discover-title" className="panel-title"><Sparkles size={16} aria-hidden="true" /> Discover</h2>
          <p className="panel-desc">{orgId ? "Your team's" : "Your"} topics, checked against every bill in Congress each morning.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={checkNow} disabled={checking || topics.length === 0}>
          <RefreshCw size={14} className={checking ? "spin" : ""} /> {checking ? "Checking…" : "Check now"}
        </button>
      </div>

      <div className="topic-chips">
        {topics.map((t) => (
          <span key={t} className={`topic${filter === t ? " is-on" : ""}`}>
            <button className="topic-name" onClick={() => setFilter(filter === t ? null : t)} aria-pressed={filter === t} title={filter === t ? "Show all suggestions" : `Show only “${t}” suggestions`}>
              {t}{counts[t] ? <span className="topic-count">{counts[t]}</span> : null}
            </button>
            <button className="topic-x" onClick={() => saveTopics(topics.filter((x) => x !== t))} aria-label={`Remove topic ${t}`}><X size={12} /></button>
          </span>
        ))}
      </div>

      <form
        className="topic-add"
        onSubmit={(e) => {
          e.preventDefault();
          addTopic(draft);
        }}
      >
        <input value={draft} onChange={(e) => { setDraft(e.target.value); if (preview) setPreview(null); }} placeholder={topics.length ? "Add a topic" : "Add a topic, like telehealth or 340B"} aria-label="New topic" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={runPreview} disabled={draft.trim().length < 2} title="See what this topic would find before adding it">
          <Eye size={14} /> Preview
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}><Plus size={14} /> Add</button>
      </form>

      {preview && (
        <div className="preview">
          {preview.loading ? (
            <p className="preview-line"><span className="spinner" aria-hidden="true" /> Searching every bill for “{preview.topic}”…</p>
          ) : preview.error ? (
            <p className="error-text">{preview.error}</p>
          ) : (
            <>
              <p className="preview-line">
                <strong>“{preview.topic}”</strong> finds {preview.bills.length === 0 ? "no bills right now. Try a broader phrase." : `${preview.bills.length} bill${preview.bills.length === 1 ? "" : "s"}`}
                {preview.bills.length > 0 && `, ${preview.bills.filter((b) => b.status === "new").length} you don't follow yet.`}
              </p>
              {preview.bills.length > 0 && (
                <ul className="preview-list">
                  {preview.bills.slice(0, 5).map((b) => (
                    <li key={b.id}>
                      <span className="cite">{citationFor(b.id)}</span>
                      <Link href={`/bill/${b.id}`}>{b.title}</Link>
                      {b.status !== "new" && <span className="preview-tag">{b.status === "tracked" ? "Tracking" : "Suggested"}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="preview-actions">
                <button className="btn btn-primary btn-sm" onClick={() => addTopic(preview.topic)}><Plus size={14} /> Watch this topic</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>Close</button>
              </div>
            </>
          )}
        </div>
      )}

      {report && (
        <div className="report" role="status">
          {report.message ? (
            <p>{report.message}</p>
          ) : (
            <>
              <p><strong>{report.added > 0 ? `${report.added} new bill${report.added === 1 ? "" : "s"} found.` : "No new bills since the last check."}</strong></p>
              <ul>
                {report.topics.map((t) => (
                  <li key={t.topic}>
                    <span className="report-topic">{t.topic}</span>
                    <span>
                      {t.failed
                        ? "search didn't respond"
                        : t.added > 0
                          ? `${t.added} new`
                          : t.found === 0
                            ? "no matching bills yet"
                            : `${t.found} match${t.found === 1 ? "" : "es"}, all already on your lists`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {items && items.length > 0 ? (
        <>
          <div className="sugg-head">
            <span>{visible.length} suggestion{visible.length === 1 ? "" : "s"}{filter ? ` for “${filter}”` : ""}</span>
            {visible.length > 1 && <button className="link-btn" onClick={() => dismiss(visible.map((v) => v.id))}>Dismiss {filter ? "these" : "all"}</button>}
          </div>
          <ul className="sugg-list">
            {visible.map((item) => {
              const bill = Array.isArray(item.bills) ? item.bills[0] : item.bills;
              if (!bill) return null;
              return (
                <li key={item.id} className="sugg">
                  <div className="sugg-main">
                    <div className="sugg-meta">
                      <span className="cite">{citationFor(item.bill_id)}</span>
                      <span className="sugg-topic">{item.matched_topic}</span>
                    </div>
                    <Link href={`/bill/${item.bill_id}`} className="sugg-title">{bill.title}</Link>
                    {item.match_reason && <p className="sugg-why">{item.match_reason.split(" · ").slice(0, 2).join(". ")}</p>}
                  </div>
                  <div className="sugg-act">
                    <button className="btn btn-secondary btn-sm" onClick={() => track(item)} disabled={busy === item.id} aria-label={`Track ${citationFor(item.bill_id)}`}>
                      {busy === item.id ? <span className="spinner" /> : <Plus size={14} />} Track
                    </button>
                    <button className="icon-btn" onClick={() => dismiss([item.id])} aria-label={`Not interested in ${citationFor(item.bill_id)}`} title="Not interested"><X size={15} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : items && topics.length > 0 && !checking ? (
        <p className="panel-empty">No suggestions waiting. New matches appear here each morning.</p>
      ) : null}
    </section>
  );
}

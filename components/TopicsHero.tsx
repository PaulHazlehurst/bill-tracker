"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { avatarColorFor } from "@/lib/billMeta";
import { useUI } from "@/components/UIProvider";
import { Sparkles, Plus, X, RefreshCw } from "lucide-react";

// Lives on the dashboard, right above the tracked bills table. Topics
// are editable right here, and "Check now" gives real, immediate
// feedback instead of a silent background process nobody can see the
// result of.
export default function TopicsHero({ onDiscovered }: { onDiscovered: () => void }) {
  const supabase = createClient();
  const { toast } = useUI();
  const [topics, setTopics] = useState<string[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  // Per-topic match history (across all time, dismissed or not) - not a
  // problem indicator, just an honest "here's what this topic has found
  // so far," so a topic that's never matched anything reads as
  // information rather than a mystery.
  const [topicMatchCounts, setTopicMatchCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: profile } = await supabase.from("profiles").select("organization_id, topics, organizations(topics)").eq("id", user.id).single();
    setOrgId(profile?.organization_id ?? null);
    const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
    setTopics((profile?.organization_id ? (org as any)?.topics : profile?.topics) ?? []);
    setLoading(false);

    // RLS already scopes prospective_bills to this caller's own org/user
    // (see schema.sql), so no extra filter is needed here - same pattern
    // the rest of this file already relies on.
    const { data: matchRows } = await supabase.from("prospective_bills").select("matched_topic");
    const counts: Record<string, number> = {};
    for (const row of matchRows ?? []) {
      counts[row.matched_topic] = (counts[row.matched_topic] ?? 0) + 1;
    }
    setTopicMatchCounts(counts);
  }

  async function saveTopics(next: string[]) {
    // Guard: don't try to save if we haven't loaded the user yet.
    if (!userId) {
      toast("Still loading — try again in a moment.", "error");
      return;
    }
    // Optimistic update, but reverted on failure - previously a failed
    // write (RLS, network, etc.) left the chip showing locally while
    // nothing was actually saved, so it silently vanished on next load
    // with no explanation. Now a failure is visible and the UI matches
    // what's actually in the database.
    const previous = topics;
    setTopics(next);
    const table = orgId ? "organizations" : "profiles";
    const id = orgId ?? userId;
    const { error } = await supabase.from(table).update({ topics: next }).eq("id", id);
    if (error) {
      setTopics(previous);
      toast(`Couldn't save that topic: ${error.message}`, "error");
      console.error("Topic save failed:", table, id, error);
    }
  }

  async function handleAddTopic(e: React.FormEvent) {
    e.preventDefault();
    const t = newTopic.trim();
    if (!t || topics.includes(t)) return;
    await saveTopics([...topics, t]);
    setNewTopic("");
  }

  async function handleRemoveTopic(t: string) {
    await saveTopics(topics.filter((x) => x !== t));
  }

  async function handleCheckNow() {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/prospective/discover-now", { method: "POST" });
      const body = await res.json();

      // TEMP diagnostic — shows exactly what each search source returned, so
      // we can tell whether GovInfo is the thing failing. Remove once fixed.
      let diagLine = "";
      if (body.diag) {
        const d = body.diag;
        const gi = d.govinfo?.ok
          ? `GovInfo ${d.govinfo.count}${d.govinfo.count ? ` (${d.govinfo.sample.join(", ")})` : ""}`
          : `GovInfo ERROR: ${d.govinfo?.error}`;
        const tm = d.titleMatch?.ok ? `title-match ${d.titleMatch.count}` : `title-match ERROR: ${d.titleMatch?.error}`;
        diagLine = `  ·  [diag "${d.topic}": ${gi}; ${tm}; key govinfo=${d.keys?.govinfo} congress=${d.keys?.congress}]`;
      }

      if (body.reason === "no topics configured") {
        setCheckResult("Add a topic below first.");
      } else if (body.searchFailed) {
        setCheckResult(`Couldn't reach congress.gov to check ${body.failedTopics?.length > 1 ? "those topics" : "that topic"} right now - try again shortly.${diagLine}`);
      } else {
        setCheckResult(
          (body.added > 0
            ? `Found ${body.added} new bill${body.added === 1 ? "" : "s"}.`
            : "No new matches right now - checked again tomorrow automatically.") + diagLine
        );
        if (body.added > 0) {
          load(); // refresh per-topic match counts, not just the list
          onDiscovered();
        }
      }
    } catch {
      setCheckResult("Couldn't check right now - try again in a moment.");
    } finally {
      setChecking(false);
    }
  }

  if (loading) return null;

  return (
    <div className="topics-hero">
      <div className="topics-hero-top">
        <div>
          <div className="first-run-badge"><Sparkles size={13} /> {orgId ? "Your team's topics" : "Your topics"}</div>
          <h1 className="topics-hero-headline">What should we watch for?</h1>
          <p className="first-run-sub" style={{ marginBottom: 0 }}>
            Every day, we check for new bills that match these - and flag anything worth tracking that isn't already on your list.
          </p>
        </div>
        <button className="ghost" onClick={handleCheckNow} disabled={checking}>
          <RefreshCw size={14} className={checking ? "spin-icon" : ""} style={{ marginRight: 6, verticalAlign: -2 }} />
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>

      {checkResult && <p className="topics-hero-result">{checkResult}</p>}

      <div className="topics-hero-chips">
        {topics.map((t) => (
          <span key={t} className="topic-chip" style={{ borderColor: avatarColorFor(t), color: avatarColorFor(t) }}>
            {t}
            <button onClick={() => handleRemoveTopic(t)} aria-label={`Remove ${t}`}><X size={12} /></button>
          </span>
        ))}
        <form onSubmit={handleAddTopic} className="topic-chip-add">
          <input
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder={topics.length === 0 ? "Add a topic, e.g. diabetes" : "Add another…"}
          />
          <button type="submit" aria-label="Add topic"><Plus size={13} /></button>
        </form>
      </div>

      {topics.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
          Matches are based on bill titles and latest-action text among the most recently updated bills - a quiet week for a topic is normal, not broken.
        </p>
      ) : (
        (() => {
          const quiet = topics.filter((t) => !topicMatchCounts[t]);
          if (quiet.length === 0) return null;
          return (
            <p className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
              No matches found yet for {quiet.map((t, i) => (
                <span key={t}>
                  {i > 0 && ", "}<strong style={{ color: "var(--text-soft)" }}>{t}</strong>
                </span>
              ))} - try a broader or differently-worded phrase if that continues.
            </p>
          );
        })()
      )}
    </div>
  );
}

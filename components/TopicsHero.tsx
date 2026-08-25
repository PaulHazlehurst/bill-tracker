"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { avatarColorFor } from "@/lib/billMeta";
import { Sparkles, Plus, X, RefreshCw } from "lucide-react";

// This is now the actual headline of the dashboard - replacing the old
// plain "Your tracked bills" header, per the direction to make topics the
// new home screen rather than a buried Settings field. Topics are
// editable right here, and "Check now" gives real, immediate feedback
// instead of a silent background process nobody can see the result of.
export default function TopicsHero({ onDiscovered }: { onDiscovered: () => void }) {
  const supabase = createClient();
  const [topics, setTopics] = useState<string[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

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
  }

  async function saveTopics(next: string[]) {
    setTopics(next);
    if (orgId) await supabase.from("organizations").update({ topics: next }).eq("id", orgId);
    else await supabase.from("profiles").update({ topics: next }).eq("id", userId);
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
      if (body.reason === "no topics configured") {
        setCheckResult("Add a topic below first.");
      } else {
        setCheckResult(
          body.added > 0
            ? `Found ${body.added} new bill${body.added === 1 ? "" : "s"}.`
            : "No new matches right now - checked again tomorrow automatically."
        );
        if (body.added > 0) onDiscovered();
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
          <h1 className="topics-hero-headline">What are you watching for?</h1>
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

      {topics.length === 0 && (
        <p className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
          Matches are based on bill titles among the most recently updated bills - a quiet week for a topic is normal, not broken.
        </p>
      )}
    </div>
  );
}

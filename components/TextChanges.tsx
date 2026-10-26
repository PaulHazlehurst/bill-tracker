"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { formatDate } from "@/lib/billMeta";
import { topicMatches } from "@/lib/weekAhead";
import type { DiffResult, SectionDiff } from "@/lib/textDiff";
import { GitCompareArrows } from "lucide-react";

type Version = { packageId: string; label: string; date: string | null };
type Response = { versions: Version[]; from?: string; to?: string; result: DiffResult | null; headline?: string; reason?: string; error?: string };

const STATUS_LABEL: Record<SectionDiff["status"], string> = {
  same: "Same",
  changed: "Edited",
  rewritten: "Rewritten",
  added: "New",
  removed: "Removed",
};

function sectionName(s: Pick<SectionDiff, "num" | "header" | "status">) {
  // A removed section keeps its old number, which may now belong to another section.
  const sec = s.status === "removed" ? "Was Sec." : "Sec.";
  if (s.num && s.header) return `${sec} ${s.num}. ${s.header}`;
  if (s.num) return `${sec} ${s.num}`;
  return s.header || "Text";
}

// "What changed" on a bill's Text tab: the latest two versions compared
// section by section, with removed words struck through in red and new
// words in green, the numbers that changed pulled out, and which of your
// topics the changes touch.
export default function TextChanges({ billId, versionCount }: { billId: string; versionCount: number }) {
  const { effectiveTopics } = useSession();
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (versionCount < 2) return;
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ billId });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    fetch(`/api/bills/text-diff?${qs}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? "Couldn't compare the versions.");
        return body as Response;
      })
      .then((body) => !cancelled && setData(body))
      .catch((e) => !cancelled && setData({ versions: data?.versions ?? [], result: null, error: e.message }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId, versionCount, from, to]);

  const result = data?.result ?? null;
  const visible = useMemo(() => (result ? result.sections.filter((s) => showAll || s.status !== "same") : []), [result, showAll]);

  const topicHits = useMemo(() => {
    if (!result) return [];
    return effectiveTopics
      .map((topic) => ({
        topic,
        sections: result.sections
          .filter((s) => s.status !== "same" && (s.ops ?? []).some((op) => (op.t === "ins" || op.t === "del") && topicMatches(topic, op.s)))
          .map((s) => (s.num ? `Sec. ${s.num}` : s.header)),
      }))
      .filter((h) => h.sections.length);
  }, [result, effectiveTopics]);

  if (versionCount < 2) {
    return (
      <section className="card">
        <h2 className="card-title">What changed</h2>
        <p className="muted">Only one version has been published so far. When a committee reports the bill or a chamber passes it, the changes will show here word by word.</p>
      </section>
    );
  }

  const versions = data?.versions ?? [];
  const fromId = data?.from ?? from;
  const toId = data?.to ?? to;
  const label = (v: Version) => `${v.label}${v.date ? `, ${formatDate(v.date)}` : ""}`;

  return (
    <section className="card rl" aria-labelledby="rl-title">
      <div className="rl-head">
        <div className="rl-head-text">
          <h2 id="rl-title" className="card-title"><GitCompareArrows size={17} aria-hidden="true" /> What changed</h2>
          <p className="card-sub">{loading ? "Comparing the two versions…" : data?.headline ?? (data?.error ? "" : "Comparing the latest two versions.")}</p>
        </div>
        {versions.length >= 2 && (
          <div className="rl-pickers">
            <label className="rl-pick">From
              <select className="select" value={fromId ?? ""} onChange={(e) => setFrom(e.target.value)} disabled={loading}>
                {versions.map((v) => <option key={v.packageId} value={v.packageId} disabled={v.packageId === toId}>{label(v)}</option>)}
              </select>
            </label>
            <label className="rl-pick">To
              <select className="select" value={toId ?? ""} onChange={(e) => setTo(e.target.value)} disabled={loading}>
                {versions.map((v) => <option key={v.packageId} value={v.packageId} disabled={v.packageId === fromId}>{label(v)}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      {loading && !result && <div className="skel skel-block" />}
      {data?.error && <p className="error-text">{data.error}</p>}
      {data?.reason === "too-large" && <p className="muted">This bill is too long to compare here. Open the two versions from the list below to read them side by side.</p>}

      {result && (
        <>
          {(result.numbers.length > 0 || topicHits.length > 0) && (
            <div className="rl-facts">
              {result.numbers.length > 0 && (
                <div className="rl-fact">
                  <h3 className="rl-fact-title">Numbers that changed</h3>
                  <dl className="rl-numbers">
                    {result.numbers.slice(0, 8).map((n, i) => (
                      <div key={i}>
                        <dt>{n.section}{n.context ? <span className="rl-ctx"> “…{n.context}”</span> : null}</dt>
                        <dd><del>{n.from}</del> <span aria-hidden="true">to</span><span className="sr-only">changed to</span> <ins>{n.to}</ins></dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {topicHits.length > 0 && (
                <div className="rl-fact">
                  <h3 className="rl-fact-title">Touches your topics</h3>
                  <ul className="rl-topics">
                    {topicHits.map((h) => <li key={h.topic}><strong>{h.topic}</strong> <span>{h.sections.join(", ")}</span></li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="rl-body">
            <nav className="rl-nav" aria-label="Sections">
              <div className="seg rl-toggle" role="group" aria-label="Which sections">
                <button aria-pressed={!showAll} onClick={() => setShowAll(false)}>Changes</button>
                <button aria-pressed={showAll} onClick={() => setShowAll(true)}>All sections</button>
              </div>
              <ol>
                {visible.map((s) => (
                  <li key={s.key}>
                    <a href={`#rl-${encodeURIComponent(s.key)}`} className={`rl-nav-item st-${s.status}`}>
                      <span className="rl-nav-name">{sectionName(s)}</span>
                      <span className="rl-tag">{STATUS_LABEL[s.status]}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="rl-text">
              {visible.length === 0 && <p className="muted">No section changed between these versions.</p>}
              {visible.map((s) => (
                <article key={s.key} id={`rl-${encodeURIComponent(s.key)}`} className={`rl-section st-${s.status}`}>
                  <h3 className="rl-section-title">
                    {sectionName(s)}
                    <span className="rl-tag">{STATUS_LABEL[s.status]}</span>
                    {(s.added > 0 || s.removed > 0) && <span className="rl-count">+{s.added} −{s.removed} words</span>}
                  </h3>
                  {s.status === "same" ? (
                    <p className="muted">No changes ({s.words.toLocaleString()} words).</p>
                  ) : (
                    <p className="official-text rl-ops">
                      {(s.ops ?? []).map((op, i) =>
                        op.t === "gap" ? (
                          <span key={i} className="rl-gap">{op.n.toLocaleString()} unchanged words</span>
                        ) : op.t === "ins" ? (
                          <ins key={i}>{op.s}</ins>
                        ) : op.t === "del" ? (
                          <del key={i}>{op.s}</del>
                        ) : (
                          <span key={i}>{op.s}</span>
                        ),
                      ).reduce<React.ReactNode[]>((acc, node, i) => (i ? [...acc, " ", node] : [node]), [])}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
          <p className="rl-source">Compared from the official text published by the Government Publishing Office. Formatting and line numbers are left out; wording is exact.</p>
        </>
      )}
    </section>
  );
}

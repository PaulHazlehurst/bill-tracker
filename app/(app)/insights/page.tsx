"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GitBranch, ArrowUpRight } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/EmptyState";
import { useSession } from "@/components/SessionProvider";
import { STAGE_LABELS, STAGE_ORDER, STAGE_SHORT } from "@/lib/billStage";
import { formatDate } from "@/lib/billMeta";
import {
  headline,
  MOMENTA,
  MOMENTUM_LABELS,
  STANCE_LABELS,
  type Insights,
  type InsightBill,
  type Momentum,
  type Stance,
  type Week,
} from "@/lib/insights";

// Insights: what the bills you follow are doing, read against your position
// on each. Replaces the old "health score" and statistics pages, which
// counted movement without asking whether movement was good news.

/** What a cell of the grid means for you, in words (never color alone). */
function cellMeaning(stance: Stance, m: Momentum): { tone: "threat" | "push" | "win" | "loss"; label: string } | null {
  if (stance === "oppose" && m === "moving") return { tone: "threat", label: "Threat" };
  if (stance === "support" && (m === "slowing" || m === "quiet")) return { tone: "push", label: "Needs a push" };
  if ((stance === "support" && m === "law") || (stance === "oppose" && m === "stopped")) return { tone: "win", label: "Win" };
  if ((stance === "support" && m === "stopped") || (stance === "oppose" && m === "law")) return { tone: "loss", label: "Loss" };
  return null;
}

export default function InsightsPage() {
  const { org } = useSession();
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/insights?scope=${scope}`)
      .then((r) => r.json())
      .then((body) => {
        if (!live) return;
        if (body.error) setError(body.error);
        else setError(null);
        setData(body.insights ?? null);
      })
      .catch(() => live && setError("Couldn't load Insights. Check your connection and refresh."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [scope]);

  return (
    <div className="page container-wide">
      <PageHeader
        title="Insights"
        description="Where the bills you follow are heading, read against where you stand on each one."
        actions={
          org ? (
            <div className="seg" role="group" aria-label="Whose bills">
              <button className={scope === "mine" ? "is-on" : ""} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>Your bills</button>
              <button className={scope === "team" ? "is-on" : ""} aria-pressed={scope === "team"} onClick={() => setScope("team")}>Whole team</button>
            </div>
          ) : undefined
        }
      />

      {loading && !data ? (
        <div className="list-skel">{[0, 1, 2].map((i) => <div key={i} className="skel skel-billrow" />)}</div>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : !data || data.total === 0 ? (
        <EmptyState icon={GitBranch} title={scope === "team" ? "Your team isn't following any bills yet" : "You're not following any bills yet"}>
          Follow a few bills from My bills and take a position on each. This page then shows which ones are threats, which need a push, and what's close to the finish.
        </EmptyState>
      ) : (
        <div className={`ins settle${loading ? " is-refreshing" : ""}`}>
          <Headline data={data} />
          <StanceGrid data={data} />
          <div className="ins-two">
            <Attention data={data} />
            <Activity weeks={data.weekly} />
          </div>
          <Pipeline data={data} />
          <div className="ins-two">
            {data.cosponsorBalance.length > 0 && <Cosponsors rows={data.cosponsorBalance} />}
            {data.clients.length > 0 && <Clients rows={data.clients} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Headline({ data }: { data: Insights }) {
  const h = headline(data);
  return (
    <section className="ins-headline" aria-label="Summary">
      <p className="ins-lead">{h.lead}</p>
      {h.detail.length > 0 && <p className="ins-detail">{h.detail.join(" ")}</p>}
      {data.attention.noPosition > 0 && (
        <p className="ins-nudge">
          {data.attention.noPosition} bill{data.attention.noPosition === 1 ? " has" : "s have"} no position, so this page can't tell whether {data.attention.noPosition === 1 ? "it's" : "they're"} good or bad news.{" "}
          <Link href="/dashboard">Set positions on My bills</Link>
        </p>
      )}
    </section>
  );
}

function BillChip({ b }: { b: Pick<InsightBill, "id" | "citation" | "title"> }) {
  return (
    <Link href={`/bill/${b.id}`} className="ins-chip" title={b.title}>
      {b.citation}
    </Link>
  );
}

function StanceGrid({ data }: { data: Insights }) {
  const MAX = 4;
  return (
    <section className="card ins-grid-card" aria-labelledby="ins-grid-title">
      <h2 className="card-title" id="ins-grid-title">Your position against each bill's momentum</h2>
      <p className="card-sub">Each bill appears once. "Moved this month" means any action in the last 30 days. "Stopped" includes vetoed and failed bills, and bills that died when their Congress ended.</p>
      <table className="ins-grid">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Your position</span></th>
            {MOMENTA.map((m) => <th key={m} scope="col">{MOMENTUM_LABELS[m]}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.stancesInUse.map((s) => (
            <tr key={s}>
              <th scope="row"><span className={`ins-stance ins-stance-${s}`}>{STANCE_LABELS[s]}</span></th>
              {MOMENTA.map((m) => {
                const bills = data.grid[s][m];
                const meaning = bills.length ? cellMeaning(s, m) : null;
                return (
                  <td key={m} data-label={MOMENTUM_LABELS[m]} className={`${meaning ? `is-${meaning.tone}` : ""}${bills.length ? "" : " is-empty"}`}>
                    {bills.length ? (
                      <>
                        <div className="ins-cell-head">
                          <span className="ins-count">{bills.length}</span>
                          {meaning && <span className="ins-tag">{meaning.label}</span>}
                        </div>
                        <div className="ins-chips">
                          {bills.slice(0, MAX).map((b) => <BillChip key={b.id} b={b} />)}
                          {bills.length > MAX && <span className="ins-more">+{bills.length - MAX} more</span>}
                        </div>
                      </>
                    ) : (
                      <span className="ins-none" aria-label="None">–</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AttentionList({ title, desc, bills, meta }: { title: string; desc: string; bills: InsightBill[]; meta: (b: InsightBill) => string }) {
  return (
    <div className="ins-att-group">
      <h3 className="ins-att-title">{title} <span className="ins-att-count">{bills.length}</span></h3>
      <p className="ins-att-desc">{desc}</p>
      {bills.length ? (
        <ul className="ins-att-list">
          {bills.slice(0, 5).map((b) => (
            <li key={b.id}>
              <Link href={`/bill/${b.id}`} className="ins-att-item">
                <span className="ins-att-cite">{b.citation}</span>
                <span className="ins-att-text">
                  <span className="ins-att-name">{b.title}</span>
                  <span className="ins-att-meta">{meta(b)}</span>
                </span>
                <ArrowUpRight size={14} aria-hidden="true" className="ins-att-go" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ins-att-empty">None right now.</p>
      )}
    </div>
  );
}

function Attention({ data }: { data: Insights }) {
  const a = data.attention;
  const last = (b: InsightBill) => `${STAGE_LABELS[b.stage] ?? b.stage}${b.latestActionDate ? `, last action ${formatDate(b.latestActionDate)}` : ""}`;
  return (
    <section className="card ins-att" aria-labelledby="ins-att-title">
      <h2 className="card-title" id="ins-att-title">Needs attention</h2>
      <AttentionList title="Moving against you" desc="Bills you oppose with action this month." bills={a.threats} meta={last} />
      <AttentionList title="Close to the finish" desc="Bills you support that have passed at least one chamber." bills={a.closeToFinish} meta={last} />
      <AttentionList
        title="Stalled"
        desc="Bills you support with no action in over a month, still before a floor vote."
        bills={a.stuck}
        meta={(b) => `${STAGE_LABELS[b.stage] ?? b.stage}, ${b.daysSinceAction ?? "?"} days without action`}
      />
      {a.split.length > 0 && (
        <AttentionList title="Team disagrees" desc="Someone supports and someone opposes. Worth a conversation." bills={a.split} meta={last} />
      )}
    </section>
  );
}

function Activity({ weeks }: { weeks: Week[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.actions));
  const total = weeks.reduce((s, w) => s + w.actions, 0);
  const label = (w: Week) => new Date(`${w.start}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <section className="card ins-act" aria-labelledby="ins-act-title">
      <h2 className="card-title" id="ins-act-title">Activity, last 12 weeks</h2>
      <p className="card-sub">{total} action{total === 1 ? "" : "s"} recorded on these bills. Stage changes are the ones that move a bill forward.</p>
      <div className="ins-legend" aria-hidden="true">
        <span><i className="ins-key ins-key-stage" /> Stage change</span>
        <span><i className="ins-key ins-key-other" /> Other action</span>
      </div>
      <div className="ins-bars" onMouseLeave={() => setActive(null)}>
        {weeks.map((w, i) => {
          const other = w.actions - w.stageChanges;
          return (
            <div
              key={w.start}
              className={`ins-bar-col${active === i ? " is-active" : ""}`}
              tabIndex={0}
              aria-label={`Week of ${label(w)}: ${w.actions} actions, ${w.stageChanges} stage changes`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <div className="ins-bar" style={{ height: `${(w.actions / max) * 100}%` }}>
                {other > 0 && <span className="ins-seg ins-seg-other" style={{ flexGrow: other }} />}
                {w.stageChanges > 0 && <span className="ins-seg ins-seg-stage" style={{ flexGrow: w.stageChanges }} />}
              </div>
              {active === i && (
                <div className="ins-tip" role="status">
                  <strong>Week of {label(w)}</strong>
                  <span>{w.actions} action{w.actions === 1 ? "" : "s"}</span>
                  <span>{w.stageChanges} stage change{w.stageChanges === 1 ? "" : "s"}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="ins-bar-axis" aria-hidden="true">
        <span>{label(weeks[0])}</span>
        <span>This week</span>
      </div>
      <table className="sr-only">
        <caption>Actions per week</caption>
        <thead><tr><th>Week of</th><th>Actions</th><th>Stage changes</th></tr></thead>
        <tbody>{weeks.map((w) => <tr key={w.start}><td>{label(w)}</td><td>{w.actions}</td><td>{w.stageChanges}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function Pipeline({ data }: { data: Insights }) {
  const stages = [...STAGE_ORDER] as string[];
  const ended = data.pipeline.some((b) => b.stage === "vetoed" || b.stage === "failed");
  if (ended) stages.push("failed");
  const col = (stage: string) => (stage === "agreed" ? "enacted" : stage === "vetoed" ? "failed" : stage);
  const shown: Stance[] = (["support", "oppose", "watching", "none", "split"] as Stance[]).filter((s) => data.pipeline.some((b) => b.stance === s));
  return (
    <section className="card ins-pipe" aria-labelledby="ins-pipe-title">
      <h2 className="card-title" id="ins-pipe-title">Where they are in the process</h2>
      <div className="ins-legend">
        {shown.map((s) => <span key={s}><i className={`ins-dot ins-dot-${s}`} /> {STANCE_LABELS[s]}</span>)}
      </div>
      <ol className="ins-pipe-track">
        {stages.map((stage) => {
          const here = data.pipeline.filter((b) => col(b.stage) === stage);
          return (
            <li key={stage} className={here.length ? "has-bills" : ""}>
              <span className="ins-pipe-label">{stage === "failed" ? "Stopped" : STAGE_SHORT[stage]}</span>
              <span className="ins-pipe-count">{here.length || ""}</span>
              <span className="ins-pipe-dots">
                {here.map((b) => (
                  <Link key={b.id} href={`/bill/${b.id}`} className={`ins-dot ins-dot-${b.stance}`} title={`${b.citation}: ${b.title} (${STANCE_LABELS[b.stance]})`}>
                    <span className="sr-only">{b.citation}, {STANCE_LABELS[b.stance]}</span>
                  </Link>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Cosponsors({ rows }: { rows: Insights["cosponsorBalance"] }) {
  return (
    <section className="card" aria-labelledby="ins-co-title">
      <h2 className="card-title" id="ins-co-title">Cosponsors by party</h2>
      <p className="card-sub">On open bills you've taken a side on. Bills with real support from both parties pass far more often.</p>
      <div className="ins-legend" aria-hidden="true">
        <span><i className="ins-key ins-key-d" /> Democrat</span>
        <span><i className="ins-key ins-key-r" /> Republican</span>
        <span><i className="ins-key ins-key-i" /> Independent</span>
      </div>
      <ul className="ins-co">
        {rows.map((b) => (
          <li key={b.id}>
            <div className="ins-co-head">
              <Link href={`/bill/${b.id}`} className="ins-att-cite">{b.citation}</Link>
              <span className={`ins-stance ins-stance-${b.stance}`}>{STANCE_LABELS[b.stance]}</span>
              {b.bipartisan && <span className="ins-tag ins-tag-plain">Bipartisan</span>}
              <span className="ins-co-n">{b.cosponsors!.D} D, {b.cosponsors!.R} R{b.cosponsors!.I ? `, ${b.cosponsors!.I} I` : ""}</span>
            </div>
            <div className="ins-co-bar" role="img" aria-label={`${b.cosponsors!.D} Democrats, ${b.cosponsors!.R} Republicans, ${b.cosponsors!.I} independents`}>
              {b.cosponsors!.D > 0 && <span className="ins-key-d" style={{ flexGrow: b.cosponsors!.D }} />}
              {b.cosponsors!.R > 0 && <span className="ins-key-r" style={{ flexGrow: b.cosponsors!.R }} />}
              {b.cosponsors!.I > 0 && <span className="ins-key-i" style={{ flexGrow: b.cosponsors!.I }} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Clients({ rows }: { rows: Insights["clients"] }) {
  return (
    <section className="card" aria-labelledby="ins-cl-title">
      <h2 className="card-title" id="ins-cl-title">By client</h2>
      <p className="card-sub">Threats are judged by the position you've taken for that client.</p>
      <table className="ins-cl">
        <thead>
          <tr><th scope="col">Client</th><th scope="col">Bills</th><th scope="col">Moved this month</th><th scope="col">Threats</th><th scope="col">Last action</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <th scope="row"><Link href={`/clients/${c.id}`}>{c.name}</Link></th>
              <td>{c.bills}</td>
              <td>{c.moving}</td>
              <td className={c.threats ? "is-threat" : ""}>{c.threats}</td>
              <td>{c.latestActionDate ? formatDate(c.latestActionDate) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

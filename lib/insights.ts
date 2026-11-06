// Insights: what the bills you follow are doing, read against where you
// stand on them. A bill you oppose that's moving is a threat; one you support
// that has gone quiet needs a push. Momentum alone (the old "health score")
// can't tell those apart, so everything here starts from your position.
//
// Pure functions: the API route gathers rows, this shapes them. Tested in
// tests/insights.test.ts. Safe on server and client.

import { citationFor, daysSince } from "@/lib/billMeta";
import { QUIET_DAYS, stageRank } from "@/lib/billStage";

export type Stance = "support" | "oppose" | "watching" | "none" | "split";
export type Momentum = "moving" | "slowing" | "quiet" | "law" | "stopped";

export const STANCES: Stance[] = ["support", "oppose", "watching", "none", "split"];
export const MOMENTA: Momentum[] = ["moving", "slowing", "quiet", "law", "stopped"];

export const STANCE_LABELS: Record<Stance, string> = {
  support: "Support",
  oppose: "Oppose",
  watching: "Watching",
  none: "No position",
  split: "Team is split",
};

/** Days without action before a bill counts as moving / slowing / quiet. */
export const MOVING_DAYS = 30;

export const MOMENTUM_LABELS: Record<Momentum, string> = {
  moving: "Moved this month",
  slowing: `Slowing (1–3 months)`,
  quiet: `Quiet (${Math.round(QUIET_DAYS / 30)}+ months)`,
  law: "Became law",
  stopped: "Stopped",
};

export type TrackerRow = { bill_id: string; position: string | null; user_id?: string };
export type BillRow = {
  id: string;
  title: string;
  status_stage: string | null;
  latest_action: string | null;
  latest_action_date: string | null;
  cosponsor_breakdown?: { D?: number; R?: number; I?: number; total?: number } | null;
};
export type EventRow = { bill_id: string; occurred_at: string; event_type: string };
/** A bill on a client's list, with the position taken for that client. */
export type ClientLink = { client_id: string; client_name: string; bill_id: string; position?: string | null };

export type InsightBill = {
  id: string;
  citation: string;
  title: string;
  stance: Stance;
  stage: string;
  momentum: Momentum;
  daysSinceAction: number | null;
  latestAction: string | null;
  latestActionDate: string | null;
  cosponsors: { D: number; R: number; I: number } | null;
};

/** One position for a bill. With a team, people who agree count once; disagreement is "split". */
export function stanceFor(positions: (string | null | undefined)[]): Stance {
  const set = new Set(positions.map((p) => (p === "support" || p === "oppose" || p === "watching" ? p : "none")));
  // "No position" from one person doesn't override a stated one from another.
  if (set.size > 1) set.delete("none");
  if (set.size === 1) return [...set][0] as Stance;
  if (set.has("support") && set.has("oppose")) return "split";
  // Watching plus one stated side: go with the stated side.
  set.delete("watching");
  return set.size === 1 ? ([...set][0] as Stance) : "split";
}

export function momentumFor(stage: string | null | undefined, latestActionDate: string | null | undefined): Momentum {
  if (stage === "enacted" || stage === "agreed") return "law";
  if (stage === "vetoed" || stage === "failed") return "stopped";
  const days = daysSince(latestActionDate);
  if (days === null || days > QUIET_DAYS) return "quiet";
  return days <= MOVING_DAYS ? "moving" : "slowing";
}

/** Monday of the week a date falls in, as YYYY-MM-DD (local time). */
export function weekStart(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export type Week = { start: string; actions: number; stageChanges: number };

/** Actions on these bills per week, oldest first, the current week last. */
export function weeklyActivity(events: EventRow[], weeks = 12, now = new Date()): Week[] {
  const out: Week[] = [];
  const cur = new Date(now);
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(cur);
    d.setDate(d.getDate() - i * 7);
    out.push({ start: weekStart(d), actions: 0, stageChanges: 0 });
  }
  const index = new Map(out.map((w, i) => [w.start, i]));
  for (const e of events) {
    const i = index.get(weekStart(new Date(e.occurred_at)));
    if (i === undefined) continue;
    out[i].actions++;
    if (e.event_type === "status_change") out[i].stageChanges++;
  }
  return out;
}

export type Insights = ReturnType<typeof buildInsights>;

export function buildInsights(input: { trackers: TrackerRow[]; bills: BillRow[]; events: EventRow[]; clients: ClientLink[]; now?: Date }) {
  const positions = new Map<string, string[]>();
  for (const t of input.trackers) {
    if (!positions.has(t.bill_id)) positions.set(t.bill_id, []);
    positions.get(t.bill_id)!.push(t.position ?? "none");
  }

  const bills: InsightBill[] = input.bills
    .filter((b) => positions.has(b.id))
    .map((b) => {
      const cb = b.cosponsor_breakdown;
      const hasCosponsors = !!cb && (cb.D ?? 0) + (cb.R ?? 0) + (cb.I ?? 0) > 0;
      return {
        id: b.id,
        citation: citationFor(b.id),
        title: b.title,
        stance: stanceFor(positions.get(b.id)!),
        stage: b.status_stage ?? "introduced",
        momentum: momentumFor(b.status_stage, b.latest_action_date),
        daysSinceAction: daysSince(b.latest_action_date),
        latestAction: b.latest_action,
        latestActionDate: b.latest_action_date,
        cosponsors: hasCosponsors ? { D: cb!.D ?? 0, R: cb!.R ?? 0, I: cb!.I ?? 0 } : null,
      };
    });

  // Stance x momentum: every bill lands in exactly one cell.
  const grid = {} as Record<Stance, Record<Momentum, InsightBill[]>>;
  for (const s of STANCES) grid[s] = Object.fromEntries(MOMENTA.map((m) => [m, [] as InsightBill[]])) as Record<Momentum, InsightBill[]>;
  for (const b of bills) grid[b.stance][b.momentum].push(b);
  const byStageThenRecent = (a: InsightBill, b: InsightBill) => stageRank(b.stage) - stageRank(a.stage) || (a.daysSinceAction ?? 1e9) - (b.daysSinceAction ?? 1e9);
  for (const s of STANCES) for (const m of MOMENTA) grid[s][m].sort(byStageThenRecent);
  const stancesInUse = STANCES.filter((s) => MOMENTA.some((m) => grid[s][m].length));

  const open = (b: InsightBill) => b.momentum !== "law" && b.momentum !== "stopped";
  const attention = {
    /** Bills you oppose that had action this month. */
    threats: bills.filter((b) => b.stance === "oppose" && b.momentum === "moving").sort(byStageThenRecent),
    /** Bills you support that have cleared at least one chamber and are still alive. */
    closeToFinish: bills.filter((b) => b.stance === "support" && open(b) && stageRank(b.stage) >= 3).sort(byStageThenRecent),
    /** Bills you support with no action in over a month. */
    stuck: bills
      .filter((b) => b.stance === "support" && (b.momentum === "slowing" || b.momentum === "quiet") && stageRank(b.stage) < 3)
      .sort((a, b) => (b.daysSinceAction ?? 1e9) - (a.daysSinceAction ?? 1e9)),
    /** Bills where the team disagrees. */
    split: bills.filter((b) => b.stance === "split"),
    noPosition: bills.filter((b) => b.stance === "none").length,
  };

  // Cosponsor balance on bills you've taken a side on: bipartisan bills pass far more often.
  const cosponsorBalance = bills
    .filter((b) => b.cosponsors && (b.stance === "support" || b.stance === "oppose") && open(b))
    .map((b) => {
      const c = b.cosponsors!;
      const total = c.D + c.R + c.I;
      const minority = Math.min(c.D, c.R);
      return { ...b, total, bipartisan: total >= 4 && minority / total >= 0.2 };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const inScope = new Map(bills.map((b) => [b.id, b]));
  const clientMap = new Map<string, { id: string; name: string; bills: (InsightBill & { clientPosition: string })[] }>();
  for (const l of input.clients) {
    const b = inScope.get(l.bill_id);
    if (!b) continue;
    if (!clientMap.has(l.client_id)) clientMap.set(l.client_id, { id: l.client_id, name: l.client_name, bills: [] });
    const c = clientMap.get(l.client_id)!;
    if (!c.bills.some((x) => x.id === b.id)) c.bills.push({ ...b, clientPosition: l.position ?? "none" });
  }
  const clients = [...clientMap.values()]
    .map((c) => {
      const latest = c.bills.map((b) => b.latestActionDate).filter(Boolean).sort().pop() ?? null;
      return {
        id: c.id,
        name: c.name,
        bills: c.bills.length,
        moving: c.bills.filter((b) => b.momentum === "moving").length,
        // Judged by the position taken for this client, not the team's own.
        threats: c.bills.filter((b) => b.clientPosition === "oppose" && b.momentum === "moving").length,
        latestActionDate: latest,
      };
    })
    .sort((a, b) => b.moving - a.moving || b.bills - a.bills || a.name.localeCompare(b.name));

  const count = (m: Momentum) => bills.filter((b) => b.momentum === m).length;
  return {
    total: bills.length,
    totals: { moving: count("moving"), slowing: count("slowing"), quiet: count("quiet"), law: count("law"), stopped: count("stopped") },
    grid,
    stancesInUse,
    attention,
    weekly: weeklyActivity(input.events, 12, input.now),
    pipeline: bills.map((b) => ({ id: b.id, citation: b.citation, title: b.title, stage: b.stage, stance: b.stance })),
    cosponsorBalance,
    clients,
  };
}

/** The sentence at the top of the page. */
export function headline(i: Pick<Insights, "total" | "totals" | "attention">): { lead: string; detail: string[] } {
  const n = i.total;
  const lead = `${n} bill${n === 1 ? "" : "s"} followed; ${i.totals.moving} moved in the last ${MOVING_DAYS} days.`;
  const detail: string[] = [];
  const t = i.attention.threats.length;
  if (t) detail.push(`${t} you oppose ${t === 1 ? "is" : "are"} moving.`);
  const c = i.attention.closeToFinish.length;
  if (c) detail.push(`${c} you support ${c === 1 ? "has" : "have"} cleared a chamber.`);
  const s = i.attention.stuck.length;
  if (s) detail.push(`${s} you support ${s === 1 ? "has" : "have"} stalled.`);
  if (!t && !c && !s && n) detail.push("Nothing you've taken a side on needs attention right now.");
  return { lead, detail };
}

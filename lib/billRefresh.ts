// SERVER-ONLY. Re-checks bills against congress.gov and records what changed.
//
// Shared by the daily poll cron, the per-bill "Check now" button, and the
// moment a bill is first tracked, so all three agree on what counts as a
// change. What it fixes compared to the old poller:
//
// 1. STAGE ACCURACY. The stage used to come from the latest action's text
//    alone, so routine follow-up actions made bills appear to go BACKWARDS
//    ("Passed House" -> "In committee" the day the Senate received it) and
//    fired false "status changed" alerts. Now, whenever a bill's actions
//    change, the full action history is fetched once and the stage is
//    derived from every milestone (see lib/billStage.ts).
//
// 2. MISSED ACTIONS. Only the single latest action was ever recorded. If a
//    bill had three actions between checks, two were silently lost. Now
//    every new action since the last check becomes its own event.
//
// 3. WRONG DATES. Events were stamped with the time the poller ran, so an
//    action from last Tuesday appeared as "today". Events now carry the
//    real action date (bill_events.action_date - see
//    supabase/2026-10-activity-and-discovery.sql).
//
// 4. MORE SIGNALS. The same bill response also tells us when new bill text,
//    a CBO cost estimate, or a CRS summary is published - all free, no
//    extra calls - so those now become events too.

import { getBill, getBillActions, type BillAction } from "@/lib/congress-api";
import { journeyFromActions, inferStageFromText, mergeStage, progressForStage, stageRank, STAGE_LABELS, TERMINAL_STAGES } from "@/lib/billStage";
import { mapLimit } from "@/lib/batch";

type Admin = any; // Supabase admin client (untyped schema)

export type StoredBill = {
  id: string;
  congress: number;
  bill_type: string;
  bill_number: number;
  title: string;
  latest_action: string | null;
  latest_action_date: string | null;
  status_stage: string;
  raw_snapshot: any;
  actions_fetched_at?: string | null;
};

export const REFRESH_COLUMNS =
  "id, congress, bill_type, bill_number, title, latest_action, latest_action_date, status_stage, raw_snapshot, actions_fetched_at";

export type NewEvent = {
  bill_id: string;
  event_type: "status_change" | "new_action" | "cosponsor_change" | "text_published" | "cbo_published" | "summary_published";
  summary: string;
  cosponsor_delta?: number;
  action_date?: string | null;
  details?: Record<string, unknown>;
};

export type RefreshOutcome = {
  id: string;
  ok: boolean;
  error?: string;
  changed: boolean;
  row?: Record<string, unknown>;
  events: NewEvent[];
};

const MAX_ACTION_EVENTS = 6;
// Re-pull the full action history at least this often even when nothing
// seems to have changed, so a stage computed before this fix is corrected.
const ACTIONS_STALE_MS = 14 * 86_400_000;

function countOf(x: any): number | null {
  if (x == null) return null;
  if (typeof x.count === "number") return x.count;
  if (Array.isArray(x)) return x.length;
  if (Array.isArray(x.item)) return x.item.length;
  return null;
}

function cboList(raw: any): any[] {
  const c = raw?.cboCostEstimates;
  if (Array.isArray(c)) return c;
  if (Array.isArray(c?.item)) return c.item;
  return [];
}

function norm(text: string) {
  return text
    .toLowerCase()
    .replace(/^(passed\/agreed to in (house|senate)|resolving differences -- (house|senate) actions):\s*/i, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// congress.gov lists actions newest-first, and often lists one floor action
// twice (once from the chamber's own system, once from the Library of
// Congress). Returns only actions newer than what we last stored, de-duped.
function newActionsSince(actions: BillAction[], lastText: string | null, lastDate: string | null): BillAction[] {
  const list = [...actions].sort((a, b) => String(b.actionDate).localeCompare(String(a.actionDate)));
  let candidates: BillAction[];
  const idx = lastText ? list.findIndex((a) => norm(a.text) === norm(lastText)) : -1;
  if (idx >= 0) candidates = list.slice(0, idx);
  else if (lastDate) candidates = list.filter((a) => String(a.actionDate) > String(lastDate));
  else candidates = list.slice(0, 1);

  const seen = new Set<string>();
  const out: BillAction[] = [];
  for (const a of candidates) {
    const key = `${a.actionDate}|${norm(a.text).slice(0, 80)}`;
    // Skip a shorter duplicate that's contained in a longer one on the same day.
    const dupe = out.some((o) => o.actionDate === a.actionDate && (norm(o.text).includes(norm(a.text)) || norm(a.text).includes(norm(o.text))));
    if (seen.has(key) || dupe) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** Fetch one bill from congress.gov and work out exactly what changed. Pure: no DB writes. */
export async function computeRefresh(bill: StoredBill, opts: { forceActions?: boolean } = {}): Promise<RefreshOutcome> {
  let b: any;
  try {
    const raw = await getBill(bill.congress, bill.bill_type, bill.bill_number);
    b = raw.bill;
    if (!b) throw new Error("empty response");
  } catch (err: any) {
    return { id: bill.id, ok: false, error: String(err?.message ?? err), changed: false, events: [] };
  }

  const events: NewEvent[] = [];
  const latestText: string = b.latestAction?.text ?? "";
  const latestDate: string | null = b.latestAction?.actionDate ?? null;
  const actionChanged = latestText !== (bill.latest_action ?? "") || (latestDate ?? null) !== (bill.latest_action_date ?? null);
  const actionsStale = !bill.actions_fetched_at || Date.now() - new Date(bill.actions_fetched_at).getTime() > ACTIONS_STALE_MS;
  const firstSeen = !bill.raw_snapshot;

  let stage = bill.status_stage || "introduced";
  let actions: BillAction[] | null = null;
  let stageFromHistory = false;

  if (actionChanged || actionsStale || opts.forceActions) {
    try {
      actions = await getBillActions(bill.congress, bill.bill_type, bill.bill_number);
      stage = journeyFromActions(actions, bill.bill_type).stage;
      stageFromHistory = true;
    } catch {
      actions = null;
    }
  }
  if (!stageFromHistory) {
    // Couldn't get the history - fall back to the latest line of text, but
    // never let that move the bill backwards.
    stage = mergeStage(bill.status_stage, inferStageFromText(latestText, bill.bill_type));
  }

  // ── Action events ──
  if (actionChanged && !firstSeen) {
    const fresh = actions ? newActionsSince(actions, bill.latest_action, bill.latest_action_date) : [];
    const list = fresh.length > 0 ? fresh : [{ actionDate: latestDate ?? "", text: latestText } as BillAction];
    const advanced = stageRank(stage) > stageRank(bill.status_stage) && stage !== bill.status_stage;
    // The action that moved the bill is the new one whose own text implies
    // the furthest stage - e.g. the passage vote, not the routine referral
    // that followed it the next day.
    let moveIdx = -1;
    if (advanced) {
      let best = -1;
      list.slice(0, MAX_ACTION_EVENTS).forEach((a, i) => {
        const r = stageRank(inferStageFromText(a.text, bill.bill_type));
        if (r > best) { best = r; moveIdx = i; }
      });
      // None of the new actions implies the jump, so the stored stage was
      // just wrong (a correction) - label nothing as "moved forward".
      if (best <= stageRank(bill.status_stage)) moveIdx = -1;
    }
    list.slice(0, MAX_ACTION_EVENTS).forEach((a, i) => {
      const isMove = i === moveIdx;
      events.push({
        bill_id: bill.id,
        event_type: isMove ? "status_change" : "new_action",
        summary: isMove ? `${STAGE_LABELS[stage] ?? stage}: ${a.text}` : a.text,
        action_date: a.actionDate || null,
        details: isMove ? { from: bill.status_stage, to: stage } : undefined,
      });
    });
    if (list.length > MAX_ACTION_EVENTS) {
      events[events.length - 1].details = { ...(events[events.length - 1].details ?? {}), moreActions: list.length - MAX_ACTION_EVENTS };
    }
  }
  // If a history re-check corrects a stage the old latest-text logic got
  // wrong (with no new action), the stage is fixed silently. Recording it as
  // an event would email people that a bill "moved" when nothing happened.

  // ── Free signals riding on the same response ──
  const old = bill.raw_snapshot;
  if (old && !firstSeen) {
    const oc = countOf(old.cosponsors);
    const nc = countOf(b.cosponsors);
    if (oc !== null && nc !== null && nc !== oc) {
      const delta = nc - oc;
      events.push({
        bill_id: bill.id,
        event_type: "cosponsor_change",
        summary: `${Math.abs(delta)} cosponsor${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "added" : "withdrawn"} (now ${nc})`,
        cosponsor_delta: delta,
        details: { from: oc, to: nc },
      });
    }
    const ot = countOf(old.textVersions);
    const nt = countOf(b.textVersions);
    if (ot !== null && nt !== null && nt > ot) {
      events.push({ bill_id: bill.id, event_type: "text_published", summary: "New version of the bill text published", details: { from: ot, to: nt } });
    }
    const ocbo = cboList(old).length;
    const ncbo = cboList(b);
    if (ncbo.length > ocbo) {
      const newest = ncbo[ncbo.length - 1];
      events.push({
        bill_id: bill.id,
        event_type: "cbo_published",
        summary: `CBO cost estimate published${newest?.description ? `: ${newest.description}` : ""}`,
        action_date: newest?.pubDate ? String(newest.pubDate).slice(0, 10) : null,
        details: { url: newest?.url ?? null },
      });
    }
    const os = countOf(old.summaries);
    const ns = countOf(b.summaries);
    if (os !== null && ns !== null && ns > os) {
      events.push({ bill_id: bill.id, event_type: "summary_published", summary: "New CRS summary of the bill published" });
    }
  }

  const row: Record<string, unknown> = {
    id: bill.id,
    congress: bill.congress,
    bill_type: bill.bill_type,
    bill_number: bill.bill_number,
    title: b.title ?? bill.title,
    latest_action: latestText || null,
    latest_action_date: latestDate,
    status_stage: stage,
    progress_pct: progressForStage(stage),
    congress_url: congressGovPublicUrl(bill),
    raw_snapshot: b,
    last_polled_at: new Date().toISOString(),
  };
  if (actions) {
    row.actions_cache = actions;
    row.actions_fetched_at = new Date().toISOString();
  }

  return { id: bill.id, ok: true, changed: events.length > 0, row, events };
}

// b.url from the API is the API url (needs a key). People should get the
// public congress.gov page instead.
export function congressGovPublicUrl(bill: { congress: number; bill_type: string; bill_number: number | string }) {
  const slug: Record<string, string> = {
    hr: "house-bill", s: "senate-bill", hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
    hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution", hres: "house-resolution", sres: "senate-resolution",
  };
  const n = bill.congress;
  const ord = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `https://www.congress.gov/bill/${n}${ord}-congress/${slug[bill.bill_type.toLowerCase()] ?? "house-bill"}/${bill.bill_number}`;
}

/**
 * bill_events gained `action_date` and `details` columns in the Oct 2026
 * migration. If that SQL hasn't been run yet, inserting them fails - so
 * retry without them rather than losing the events. Same for bills columns.
 */
export async function insertEventsSafe(admin: Admin, events: NewEvent[]): Promise<{ error: string | null }> {
  if (events.length === 0) return { error: null };
  const { error } = await admin.from("bill_events").insert(events);
  if (!error) return { error: null };
  if (/action_date|details|column/i.test(error.message ?? "")) {
    const stripped = events.map(({ action_date, details, ...rest }) => rest);
    const retry = await admin.from("bill_events").insert(stripped);
    return { error: retry.error?.message ?? null };
  }
  return { error: error.message };
}

export async function writeBillRows(admin: Admin, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const { error } = await admin.from("bills").upsert(rows, { onConflict: "id" });
  if (!error) return;
  // Safety net: polling is the app's core job, so if the bulk write fails
  // (unexpected constraint, a column this payload doesn't know about), fall
  // back to one row at a time rather than losing the whole batch.
  console.error("bulk bill upsert failed, falling back to per-row updates", error);
  await mapLimit(rows, 4, async (row) => {
    const { id, ...fields } = row as any;
    const { error: rowError } = await admin.from("bills").update(fields).eq("id", id);
    if (rowError) console.error(`row update failed for ${id}`, rowError);
  });
}

export function nextPollAt(stage: string, tracked: boolean) {
  // The cron runs once a day. Tracked, still-moving bills are checked every
  // run; finished or untracked ones (e.g. discovery suggestions) weekly.
  const days = !tracked || TERMINAL_STAGES.has(stage) ? 7 : 0.5;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Builds the row for a bill we've never cached before. Used by tracking and
 * by discovery so a brand-new bill gets an accurate stage and a working
 * public link from day one. The action-history call is best-effort: if it
 * fails, the stage falls back to the latest-action text.
 */
export async function buildNewBillRow(congress: number, billType: string, billNumber: number | string, opts: { withHistory?: boolean } = {}) {
  const type = billType.toLowerCase();
  const number = parseInt(String(billNumber), 10);
  const raw = await getBill(congress, type, number);
  const b = raw.bill;
  if (!b) throw new Error("congress.gov returned no bill");
  const latestText: string = b.latestAction?.text ?? "";

  let stage = inferStageFromText(latestText, type);
  let actions: BillAction[] | null = null;
  if (opts.withHistory !== false) {
    try {
      actions = await getBillActions(congress, type, number);
      stage = journeyFromActions(actions, type).stage;
    } catch {
      /* fall back to text inference */
    }
  }

  const row: Record<string, unknown> = {
    id: `${type}-${number}-${congress}`,
    congress,
    bill_type: type,
    bill_number: number, // integer column - a string here silently fails the insert
    title: b.title ?? `${type.toUpperCase()} ${number}`,
    latest_action: latestText || null,
    latest_action_date: b.latestAction?.actionDate ?? null,
    status_stage: stage,
    progress_pct: progressForStage(stage),
    congress_url: congressGovPublicUrl({ congress, bill_type: type, bill_number: number }),
    raw_snapshot: b,
    last_polled_at: new Date().toISOString(),
    next_poll_at: nextPollAt(stage, true),
    poll_priority: "normal",
  };
  if (actions) {
    row.actions_cache = actions;
    row.actions_fetched_at = new Date().toISOString();
  }
  return row;
}

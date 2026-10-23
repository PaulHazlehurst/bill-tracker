// SERVER-ONLY. Automated topic-based bill discovery.
//
// For each org (or solo user) with topics configured, finds bills matching
// those topics that aren't already tracked, already suggested, or a
// companion of something tracked, and files them as suggestions in
// prospective_bills. Never auto-tracks: a suggestion someone reviews is
// fundamentally different from a bill silently added to their list.
//
// Why it "barely ever found anything" before (Oct 2026 diagnosis):
//   1. It took the top 15 search hits FIRST and filtered out known bills
//      SECOND. After the first run, the same top 15 came back every day and
//      were all "already suggested", so every later run found nothing new -
//      even when bill #16 onward was a perfect match.
//   2. Ceremonial resolutions counted against those 15 slots.
//   3. The search itself was one loosely-ranked full-text query plus a
//      title scan that needed every word verbatim ("rural hospitals" never
//      matched a title saying "rural hospital").
//   4. "Check now" ran with no time allowance, so a few topics could exceed
//      the platform's default limit and fail as "couldn't check right now".
// See searchBillsRanked in lib/congress-api.ts for the new search.

import { createAdminClient } from "@/lib/supabase/server";
import { searchBillsRanked, getRelatedBills, RESOLUTION_TYPES, type SearchResult } from "@/lib/congress-api";
import { buildNewBillRow } from "@/lib/billRefresh";
import { mapLimit, deadline, rotateByDay } from "@/lib/batch";

const CURRENT_CONGRESS = 119;
// New suggestions per topic per run. Bounded so a broad topic can't flood
// the list - the next run picks up the next-best matches.
const MAX_NEW_PER_TOPIC = 8;
// A bill must score at least this to be suggested (see searchBillsRanked).
// Filters out "every word appears somewhere in a 900-page bill" noise.
const MIN_SCORE = 2.5;
const CANDIDATE_CONCURRENCY = 5;
const TOPIC_CONCURRENCY = 2;
const MAX_RELATED_WARMUPS = 3;

export type TopicReport = {
  topic: string;
  found: number;
  alreadyTracked: number;
  alreadySuggested: number;
  added: number;
  failed: boolean;
};

export type DiscoveryResult = {
  added: number;
  failedTopics: string[];
  topics: TopicReport[];
  timedOut: boolean;
  firstError: string | null;
};

type Admin = ReturnType<typeof createAdminClient>;

async function ensureBillCached(admin: Admin, r: SearchResult): Promise<{ ok: boolean; error?: string }> {
  const billId = `${r.type.toLowerCase()}-${r.number}-${r.congress}`;
  const { data: existing } = await admin.from("bills").select("id").eq("id", billId).maybeSingle();
  if (existing) return { ok: true };
  try {
    // Untracked suggestion: skip the extra history call; the poller fills
    // it in if someone tracks the bill.
    const row = await buildNewBillRow(r.congress, r.type, r.number, { withHistory: false });
    row.next_poll_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
    row.poll_priority = "dormant";
    const { error } = await admin.from("bills").insert(row);
    if (error && error.code !== "23505") return { ok: false, error: `bills insert: ${error.message}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `getBill: ${String(err?.message ?? err)}` };
  }
}

/** The owner's tracked + already-suggested bills, plus companions of tracked bills. */
async function loadOwnerContext(admin: Admin, organizationId?: string, userId?: string) {
  let trackedQuery = admin.from("tracked_bills").select("bill_id");
  if (organizationId) {
    // Org-wide: anything any current member tracks.
    const { data: members } = await admin.from("profiles").select("id").eq("organization_id", organizationId);
    const ids = (members ?? []).map((m: any) => m.id);
    trackedQuery = ids.length ? trackedQuery.in("user_id", ids) : trackedQuery.eq("organization_id", organizationId);
  } else {
    trackedQuery = trackedQuery.eq("user_id", userId!);
  }
  const { data: trackedRows } = await trackedQuery;
  const tracked = new Set<string>((trackedRows ?? []).map((r: any) => r.bill_id));

  let prospectiveQuery = admin.from("prospective_bills").select("bill_id");
  prospectiveQuery = organizationId ? prospectiveQuery.eq("organization_id", organizationId) : prospectiveQuery.eq("user_id", userId!);
  const { data: prospectiveRows } = await prospectiveQuery;
  const suggested = new Set<string>((prospectiveRows ?? []).map((r: any) => r.bill_id));

  // Companion exclusion from CACHED related-bills data on the tracked side
  // (congress.gov relatedBills is bidirectional), not one API call per
  // candidate. A tracked bill nobody has opened may not have that cache
  // yet, so a few are warmed per run.
  const companions = new Set<string>();
  const needsWarming: { id: string; congress: number; bill_type: string; bill_number: number }[] = [];
  const trackedList = Array.from(tracked);
  for (let i = 0; i < trackedList.length; i += 100) {
    const { data } = await admin.from("bills").select("id, congress, bill_type, bill_number, related_bills").in("id", trackedList.slice(i, i + 100));
    for (const row of (data as any[]) ?? []) {
      if (Array.isArray(row.related_bills)) {
        for (const r of row.related_bills) {
          if (r?.type && r?.number && r?.congress) companions.add(`${String(r.type).toLowerCase()}-${r.number}-${r.congress}`);
        }
      } else if (row.related_bills == null) {
        needsWarming.push(row);
      }
    }
  }
  return { tracked, suggested, companions, needsWarming };
}

async function insertProspective(admin: Admin, rows: any[]) {
  if (rows.length === 0) return { error: null as string | null };
  let { error } = await admin.from("prospective_bills").insert(rows);
  // match_reason / match_score arrive with the Oct 2026 migration; if it
  // hasn't been run, insert without them rather than losing the suggestions.
  if (error && /match_reason|match_score|column/i.test(error.message)) {
    ({ error } = await admin.from("prospective_bills").insert(rows.map(({ match_reason, match_score, ...r }) => r)));
  }
  // A unique-constraint clash means a concurrent run already filed one of
  // these - retry row by row so the rest still land.
  if (error && error.code === "23505") {
    let firstErr: string | null = null;
    for (const row of rows) {
      const r = await admin.from("prospective_bills").insert(row);
      if (r.error && r.error.code !== "23505" && !firstErr) firstErr = r.error.message;
    }
    return { error: firstErr };
  }
  return { error: error?.message ?? null };
}

export async function runDiscoveryForOwner(opts: {
  organizationId?: string;
  userId?: string;
  topics: string[];
  budgetMs?: number;
}): Promise<DiscoveryResult> {
  const { organizationId, userId } = opts;
  const topics = Array.from(new Set(opts.topics.map((t) => t.trim()).filter(Boolean)));
  const result: DiscoveryResult = { added: 0, failedTopics: [], topics: [], timedOut: false, firstError: null };
  if (topics.length === 0) return result;

  const clock = deadline(opts.budgetMs ?? 45_000);
  const admin = createAdminClient();
  const ctx = await loadOwnerContext(admin, organizationId, userId);

  const reports = await mapLimit(topics, TOPIC_CONCURRENCY, async (topic): Promise<TopicReport> => {
    const report: TopicReport = { topic, found: 0, alreadyTracked: 0, alreadySuggested: 0, added: 0, failed: false };
    if (clock.expired()) {
      result.timedOut = true;
      return report;
    }

    let results: SearchResult[];
    try {
      ({ results } = await searchBillsRanked(topic, { congress: CURRENT_CONGRESS, recentPages: 2, limit: 60 }));
    } catch (err: any) {
      report.failed = true;
      if (!result.firstError) result.firstError = String(err?.message ?? err);
      return report;
    }

    // Filter FIRST, then take the best remaining - the old order was the bug.
    const fresh: SearchResult[] = [];
    for (const r of results) {
      const type = r.type.toLowerCase();
      if (RESOLUTION_TYPES.has(type)) continue;
      if ((r.score ?? 0) < MIN_SCORE) continue;
      report.found++;
      const id = `${type}-${r.number}-${r.congress}`;
      if (ctx.tracked.has(id)) { report.alreadyTracked++; continue; }
      if (ctx.suggested.has(id) || ctx.companions.has(id)) { report.alreadySuggested++; continue; }
      if (fresh.length >= MAX_NEW_PER_TOPIC) continue;
      ctx.suggested.add(id); // claim it so another topic can't duplicate it
      fresh.push(r);
    }

    const cached = await mapLimit(fresh, CANDIDATE_CONCURRENCY, async (r) => ({ r, res: await ensureBillCached(admin, r) }));
    const rows: any[] = [];
    for (const { r, res } of cached) {
      const id = `${r.type.toLowerCase()}-${r.number}-${r.congress}`;
      if (!res.ok) {
        ctx.suggested.delete(id); // didn't land - allow a retry next run
        if (!result.firstError) result.firstError = res.error ?? "cache failed";
        continue;
      }
      rows.push({
        organization_id: organizationId ?? null,
        user_id: organizationId ? null : userId,
        bill_id: id,
        matched_topic: topic,
        match_reason: (r.reasons ?? []).slice(0, 3).join(" · ") || null,
        match_score: Math.round((r.score ?? 0) * 10) / 10,
      });
    }
    const { error } = await insertProspective(admin, rows);
    if (error) {
      if (!result.firstError) result.firstError = `prospective insert: ${error}`;
    } else {
      report.added = rows.length;
    }
    return report;
  });

  result.topics = reports;
  result.added = reports.reduce((n, r) => n + r.added, 0);
  result.failedTopics = reports.filter((r) => r.failed).map((r) => r.topic);

  // Background nicety: warm a few tracked bills' related-bills cache so the
  // companion check gets more accurate over time. Failures are ignored.
  if (ctx.needsWarming.length > 0 && clock.remainingMs() > 5_000) {
    await mapLimit(ctx.needsWarming.slice(0, MAX_RELATED_WARMUPS), 2, async (row) => {
      try {
        const related = await getRelatedBills(row.congress, row.bill_type, row.bill_number);
        await admin.from("bills").update({ related_bills: related, related_bills_fetched_at: new Date().toISOString() }).eq("id", row.id);
      } catch {
        /* try again on a future run */
      }
    });
  }

  return result;
}

// Runs discovery for every org and every solo (no-org) user with topics.
// Called from the notify cron. Owners are processed until the time budget is
// spent; the order rotates daily so nobody is starved.
export async function runDiscoveryForAllOwners(
  budgetMs = 30_000,
): Promise<{ owners: number; added: number; skipped: number; timedOut: boolean; failedTopics: number }> {
  const admin = createAdminClient();
  const clock = deadline(budgetMs);
  type Owner = { kind: "org" | "user"; id: string; topics: string[] };
  const owners: Owner[] = [];

  const { data: orgs } = await admin.from("organizations").select("id, topics");
  for (const org of (orgs as any[]) ?? []) {
    if (Array.isArray(org.topics) && org.topics.length > 0) owners.push({ kind: "org", id: org.id, topics: org.topics });
  }
  const { data: solo } = await admin.from("profiles").select("id, topics").is("organization_id", null);
  for (const p of (solo as any[]) ?? []) {
    if (Array.isArray(p.topics) && p.topics.length > 0) owners.push({ kind: "user", id: p.id, topics: p.topics });
  }

  let added = 0;
  let done = 0;
  let failedTopics = 0;
  let timedOut = false;
  for (const owner of rotateByDay(owners)) {
    if (clock.remainingMs() < 6_000) {
      timedOut = true;
      break;
    }
    try {
      const res = await runDiscoveryForOwner({
        organizationId: owner.kind === "org" ? owner.id : undefined,
        userId: owner.kind === "user" ? owner.id : undefined,
        topics: owner.topics,
        budgetMs: clock.remainingMs() - 2_000,
      });
      added += res.added;
      failedTopics += res.failedTopics.length;
      done++;
      if (res.timedOut) {
        timedOut = true;
        break;
      }
    } catch (err) {
      console.error(`discovery failed for ${owner.kind} ${owner.id}`, err);
    }
  }
  return { owners: done, added, skipped: owners.length - done, timedOut, failedTopics };
}

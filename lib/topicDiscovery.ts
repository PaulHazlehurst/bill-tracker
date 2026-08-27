// SERVER-ONLY. Automated topic-based bill discovery. For each org (or
// solo user) with topics configured, searches for new bills matching
// those topics, excludes anything already tracked, and - importantly -
// excludes companion/duplicate bills of anything already tracked, using
// congress.gov's own relatedBills data. Populates the prospective_bills
// table; never auto-tracks anything, since a suggestion the user reviews
// is fundamentally different from a bill silently added to their list.

import { createAdminClient } from "@/lib/supabase/server";
import { searchBillsSmart, getBill, getRelatedBills, inferStage, progressForStage } from "@/lib/congress-api";

const CURRENT_CONGRESS = 119;
const MAX_PER_TOPIC = 15; // keep this bounded - a broad topic word could otherwise flood the list

async function ensureBillCached(admin: ReturnType<typeof createAdminClient>, billId: string, congress: number, billType: string, billNumber: string): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await admin.from("bills").select("id").eq("id", billId).maybeSingle();
  if (existing) return { ok: true };

  try {
    const raw = await getBill(congress, billType, billNumber);
    const b = raw.bill;
    const latestActionText = b.latestAction?.text ?? "";
    const stage = inferStage(latestActionText);

    const { error } = await admin.from("bills").insert({
      id: billId,
      congress,
      bill_type: billType.toLowerCase(),
      // bills.bill_number is an INTEGER column - passing the string form
      // silently fails the insert, which then breaks the foreign-key on
      // prospective_bills. Coerce to a real number.
      bill_number: parseInt(String(billNumber), 10),
      title: b.title ?? `${billType.toUpperCase()} ${billNumber}`,
      latest_action: latestActionText || null,
      latest_action_date: b.latestAction?.actionDate ?? null,
      status_stage: stage,
      progress_pct: progressForStage(stage),
      congress_url: b.url ?? null,
      raw_snapshot: b,
      last_polled_at: new Date().toISOString(),
      next_poll_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      poll_priority: "normal",
    });
    if (error) {
      console.error(`discovery: bills insert failed for ${billId}`, error);
      return { ok: false, error: `bills insert: ${error.message}` };
    }
    return { ok: true };
  } catch (err: any) {
    console.error(`discovery: failed to cache candidate bill ${billId}`, err);
    return { ok: false, error: `getBill: ${String(err?.message ?? err)}` };
  }
}

// Runs discovery for one owner (an org, or a solo user) against their own
// topic list and their own already-tracked bills. Returns how many new
// prospective bills were added, plus which topics failed to search at all
// (a congress.gov outage/rate-limit/bad-key looks identical to "zero
// matches" unless the caller can tell the two apart - see discover-now's
// route, which uses failedTopics to give an honest error instead of a
// false "no new matches").
export async function runDiscoveryForOwner(opts: { organizationId?: string; userId?: string; topics: string[] }): Promise<{ added: number; failedTopics: string[]; debug: any }> {
  const { organizationId, userId, topics } = opts;
  // Counters so "Check now" can report exactly where candidates go, instead
  // of silently ending at "no matches."
  const debug = { candidates: 0, skippedKnown: 0, skippedCompanion: 0, cacheFailed: 0, prospectiveFailed: 0, inserted: 0, firstError: null as string | null };
  if (topics.length === 0) return { added: 0, failedTopics: [], debug };
  const admin = createAdminClient();

  // What's already tracked by this owner - both to skip exact matches and
  // as the basis for the companion-bill check below.
  let trackedQuery = admin.from("tracked_bills").select("bill_id");
  trackedQuery = organizationId ? trackedQuery.eq("organization_id", organizationId) : trackedQuery.eq("user_id", userId!);
  const { data: trackedRows } = await trackedQuery;
  const trackedBillIds = new Set((trackedRows ?? []).map((r) => r.bill_id));

  // Already-suggested bills (dismissed or not) shouldn't be re-inserted -
  // a dismissed suggestion should stay dismissed, and a pending one
  // shouldn't get duplicated.
  let existingProspectiveQuery = admin.from("prospective_bills").select("bill_id");
  existingProspectiveQuery = organizationId
    ? existingProspectiveQuery.eq("organization_id", organizationId)
    : existingProspectiveQuery.eq("user_id", userId!);
  const { data: existingProspectiveRows } = await existingProspectiveQuery;
  const alreadySuggested = new Set((existingProspectiveRows ?? []).map((r) => r.bill_id));

  let added = 0;
  const failedTopics: string[] = [];

  for (const topic of topics) {
    let results;
    try {
      // GovInfo full-text search is the primary source here - it searches
      // the actual TEXT of every bill in the congress, so a topic keyword
      // surfaces bills whose titles never mention it (exactly the quiet
      // bills this feature exists to catch). searchBillsSmart also merges
      // in a title/recency match (titlePages=3, ~750 recent bills) as a
      // safety net for brand-new bills GovInfo hasn't indexed yet, and only
      // throws if BOTH sources are down.
      results = await searchBillsSmart(topic, CURRENT_CONGRESS, 3);
    } catch (err) {
      console.error(`discovery: search failed for topic "${topic}"`, err);
      failedTopics.push(topic);
      continue;
    }

    for (const r of results.slice(0, MAX_PER_TOPIC)) {
      debug.candidates++;
      const billId = `${r.type.toLowerCase()}-${r.number}-${r.congress}`;
      if (trackedBillIds.has(billId) || alreadySuggested.has(billId)) { debug.skippedKnown++; continue; }

      // The real point: exclude companion/duplicate bills of anything
      // already tracked. A Senate companion of a House bill the org
      // already tracks isn't a new opportunity, it's the same policy.
      let isCompanionOfTracked = false;
      try {
        const related = await getRelatedBills(r.congress, r.type, r.number);
        for (const rel of related) {
          const relId = `${rel.type.toLowerCase()}-${rel.number}-${rel.congress}`;
          if (trackedBillIds.has(relId)) {
            isCompanionOfTracked = true;
            break;
          }
        }
      } catch (err) {
        // If the related-bills check fails, err on the side of still
        // showing the suggestion rather than silently dropping it -
        // a missed duplicate is a much smaller problem than a missed
        // genuine opportunity.
        console.error(`discovery: related-bills check failed for ${billId}`, err);
      }
      if (isCompanionOfTracked) { debug.skippedCompanion++; continue; }

      const cached = await ensureBillCached(admin, billId, r.congress, r.type, r.number);
      if (!cached.ok) {
        debug.cacheFailed++;
        if (!debug.firstError) debug.firstError = cached.error ?? "cache failed";
        continue;
      }

      const { error: insertError } = await admin.from("prospective_bills").insert({
        organization_id: organizationId ?? null,
        user_id: organizationId ? null : userId,
        bill_id: billId,
        matched_topic: topic,
      });
      if (!insertError) {
        added++;
        debug.inserted++;
        alreadySuggested.add(billId); // avoid a second topic re-adding the same bill in this same run
      } else {
        debug.prospectiveFailed++;
        if (!debug.firstError) debug.firstError = `prospective insert: ${insertError.message}`;
      }
    }
  }

  return { added, failedTopics, debug };
}

// Runs discovery across every org and every solo (no-org) user that has
// topics configured. Called from the daily poll cron - see the note in
// that file about not registering a separate cron endpoint.
export async function runDiscoveryForAllOwners(): Promise<{ owners: number; added: number }> {
  const admin = createAdminClient();
  let totalAdded = 0;
  let ownerCount = 0;

  const { data: orgs } = await admin.from("organizations").select("id, topics").not("topics", "eq", "{}");
  for (const org of orgs ?? []) {
    if (!org.topics || org.topics.length === 0) continue;
    ownerCount++;
    totalAdded += (await runDiscoveryForOwner({ organizationId: org.id, topics: org.topics })).added;
  }

  const { data: soloProfiles } = await admin
    .from("profiles")
    .select("id, topics")
    .is("organization_id", null)
    .not("topics", "eq", "{}");
  for (const profile of soloProfiles ?? []) {
    if (!profile.topics || profile.topics.length === 0) continue;
    ownerCount++;
    totalAdded += (await runDiscoveryForOwner({ userId: profile.id, topics: profile.topics })).added;
  }

  return { owners: ownerCount, added: totalAdded };
}

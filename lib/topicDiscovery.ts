// SERVER-ONLY. Automated topic-based bill discovery. For each org (or
// solo user) with topics configured, searches for new bills matching
// those topics, excludes anything already tracked, and - importantly -
// excludes companion/duplicate bills of anything already tracked, using
// congress.gov's own relatedBills data. Populates the prospective_bills
// table; never auto-tracks anything, since a suggestion the user reviews
// is fundamentally different from a bill silently added to their list.

import { createAdminClient } from "@/lib/supabase/server";
import { searchBills, getBill, getRelatedBills, inferStage, progressForStage } from "@/lib/congress-api";

const CURRENT_CONGRESS = 119;
const MAX_PER_TOPIC = 8; // keep this bounded - a broad topic word could otherwise flood the list

async function ensureBillCached(admin: ReturnType<typeof createAdminClient>, billId: string, congress: number, billType: string, billNumber: string) {
  const { data: existing } = await admin.from("bills").select("id").eq("id", billId).maybeSingle();
  if (existing) return true;

  try {
    const raw = await getBill(congress, billType, billNumber);
    const b = raw.bill;
    const latestActionText = b.latestAction?.text ?? "";
    const stage = inferStage(latestActionText);

    await admin.from("bills").insert({
      id: billId,
      congress,
      bill_type: billType.toLowerCase(),
      bill_number: billNumber,
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
    return true;
  } catch (err) {
    console.error(`discovery: failed to cache candidate bill ${billId}`, err);
    return false;
  }
}

// Runs discovery for one owner (an org, or a solo user) against their own
// topic list and their own already-tracked bills. Returns how many new
// prospective bills were added, for logging/testing visibility.
export async function runDiscoveryForOwner(opts: { organizationId?: string; userId?: string; topics: string[] }): Promise<number> {
  const { organizationId, userId, topics } = opts;
  if (topics.length === 0) return 0;
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

  for (const topic of topics) {
    let results;
    try {
      results = await searchBills(topic, CURRENT_CONGRESS);
    } catch (err) {
      console.error(`discovery: search failed for topic "${topic}"`, err);
      continue;
    }

    for (const r of results.slice(0, MAX_PER_TOPIC)) {
      const billId = `${r.type.toLowerCase()}-${r.number}-${r.congress}`;
      if (trackedBillIds.has(billId) || alreadySuggested.has(billId)) continue;

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
      if (isCompanionOfTracked) continue;

      const cached = await ensureBillCached(admin, billId, r.congress, r.type, r.number);
      if (!cached) continue;

      const { error: insertError } = await admin.from("prospective_bills").insert({
        organization_id: organizationId ?? null,
        user_id: organizationId ? null : userId,
        bill_id: billId,
        matched_topic: topic,
      });
      if (!insertError) {
        added++;
        alreadySuggested.add(billId); // avoid a second topic re-adding the same bill in this same run
      }
    }
  }

  return added;
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
    totalAdded += await runDiscoveryForOwner({ organizationId: org.id, topics: org.topics });
  }

  const { data: soloProfiles } = await admin
    .from("profiles")
    .select("id, topics")
    .is("organization_id", null)
    .not("topics", "eq", "{}");
  for (const profile of soloProfiles ?? []) {
    if (!profile.topics || profile.topics.length === 0) continue;
    ownerCount++;
    totalAdded += await runDiscoveryForOwner({ userId: profile.id, topics: profile.topics });
  }

  return { owners: ownerCount, added: totalAdded };
}

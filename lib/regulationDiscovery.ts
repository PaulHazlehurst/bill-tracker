// SERVER-ONLY. Match new federal regulations against each owner's topic
// list. Structural mirror of lib/topicDiscovery.ts - same ownership model
// (org OR solo user), same rotate-by-day fairness, same time budget.
//
// Runs from the notify cron alongside bill discovery. See
// app/api/cron/notify/route.ts for the wiring.

import { createAdminClient } from "@/lib/supabase/server";
import { searchRegulations, FRDocument } from "@/lib/federalRegister-api";
import { mapLimit, deadline, rotateByDay } from "@/lib/batch";

const MAX_PER_TOPIC = 10;
const SINCE_DAYS_AGO = 30; // one month lookback per run - the daily cron catches everything current
const CANDIDATE_CONCURRENCY = 6;

async function ensureRegulationCached(admin: ReturnType<typeof createAdminClient>, doc: FRDocument): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await admin.from("regulations").select("id").eq("id", doc.documentNumber).maybeSingle();
  if (existing) return { ok: true };

  const { error } = await admin.from("regulations").insert({
    id: doc.documentNumber,
    title: doc.title,
    abstract: doc.abstract,
    doc_type: doc.docType,
    docket_id: doc.docketId,
    agencies: doc.agencies,
    publication_date: doc.publicationDate,
    comment_close_date: doc.commentCloseDate,
    effective_date: doc.effectiveDate,
    html_url: doc.htmlUrl,
    pdf_url: doc.pdfUrl,
    raw_snapshot: doc.raw,
    last_polled_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: `regulations insert: ${error.message}` };
  return { ok: true };
}

export async function runRegDiscoveryForOwner(opts: { organizationId?: string; userId?: string; topics: string[] }): Promise<{ added: number; failedTopics: string[] }> {
  const { organizationId, userId, topics } = opts;
  if (topics.length === 0) return { added: 0, failedTopics: [] };
  const admin = createAdminClient();

  // Skip anything this owner has already been offered (dismissed counts,
  // same as the bill-side rule).
  let existingQuery = admin.from("prospective_regulations").select("regulation_id");
  existingQuery = organizationId
    ? existingQuery.eq("organization_id", organizationId)
    : existingQuery.eq("user_id", userId!);
  const { data: existingRows } = await existingQuery;
  const alreadySuggested = new Set((existingRows ?? []).map((r) => r.regulation_id));

  let added = 0;
  const failedTopics: string[] = [];

  for (const topic of topics) {
    let results: FRDocument[];
    try {
      results = await searchRegulations(topic, { sinceDaysAgo: SINCE_DAYS_AGO, perPage: MAX_PER_TOPIC * 2 });
    } catch (err) {
      console.error(`reg discovery: search failed for topic "${topic}"`, err);
      failedTopics.push(topic);
      continue;
    }

    const fresh = results.filter((r) => !alreadySuggested.has(r.documentNumber)).slice(0, MAX_PER_TOPIC);
    for (const doc of fresh) alreadySuggested.add(doc.documentNumber); // claim early to prevent duplicates across topics

    // Cache concurrently.
    const cached = await mapLimit(fresh, CANDIDATE_CONCURRENCY, async (doc) => {
      const ok = await ensureRegulationCached(admin, doc);
      return { doc, ok };
    });

    const toInsert = cached.filter((c) => c.ok.ok).map(({ doc }) => ({
      organization_id: organizationId ?? null,
      user_id: organizationId ? null : userId,
      regulation_id: doc.documentNumber,
      matched_topic: topic,
    }));

    if (toInsert.length === 0) continue;
    const { error: insertError } = await admin.from("prospective_regulations").insert(toInsert);
    if (!insertError) {
      added += toInsert.length;
    } else {
      // Undo the early claim so a future run can retry these.
      for (const row of toInsert) alreadySuggested.delete(row.regulation_id);
      console.error(`reg discovery: prospective insert failed for topic "${topic}"`, insertError);
    }
  }

  return { added, failedTopics };
}

export async function runRegDiscoveryForAllOwners(
  budgetMs = 20_000
): Promise<{ owners: number; added: number; skipped: number; timedOut: boolean }> {
  const admin = createAdminClient();
  const clock = deadline(budgetMs);
  let ownerCount = 0;
  let totalAdded = 0;

  type Owner = { kind: "org" | "user"; id: string; topics: string[] };
  const owners: Owner[] = [];

  const { data: orgs } = await admin.from("organizations").select("id, topics").not("topics", "eq", "{}");
  for (const org of orgs ?? []) {
    if (!org.topics || org.topics.length === 0) continue;
    owners.push({ kind: "org", id: org.id, topics: org.topics });
  }
  const { data: soloProfiles } = await admin
    .from("profiles")
    .select("id, topics")
    .is("organization_id", null)
    .not("topics", "eq", "{}");
  for (const profile of soloProfiles ?? []) {
    if (!profile.topics || profile.topics.length === 0) continue;
    owners.push({ kind: "user", id: profile.id, topics: profile.topics });
  }

  const ordered = rotateByDay(owners);
  let timedOut = false;
  for (const owner of ordered) {
    if (clock.expired()) { timedOut = true; break; }
    try {
      const res = owner.kind === "org"
        ? await runRegDiscoveryForOwner({ organizationId: owner.id, topics: owner.topics })
        : await runRegDiscoveryForOwner({ userId: owner.id, topics: owner.topics });
      totalAdded += res.added;
      ownerCount++;
    } catch (err) {
      console.error(`reg discovery failed for ${owner.kind} ${owner.id}`, err);
    }
  }
  return { owners: ownerCount, added: totalAdded, skipped: ordered.length - ownerCount, timedOut };
}

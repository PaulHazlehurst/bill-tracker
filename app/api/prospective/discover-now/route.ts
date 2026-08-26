import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDiscoveryForOwner } from "@/lib/topicDiscovery";

// POST - runs discovery immediately for the signed-in user's own owner
// (org or self), rather than waiting for the next daily cron cycle. This
// is what powers "first time they login we show them bills they should
// be tracking" - a brand-new account with topics set shouldn't have to
// wait up to 24 hours to see anything.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, topics")
    .eq("id", user.id)
    .single();

  let topics = profile?.topics ?? [];
  let organizationId: string | undefined = profile?.organization_id ?? undefined;

  // If they're on an org, use the ORG's topics (shared, per schema.sql),
  // not their personal ones - matches how discovery runs in the daily
  // cron for org members.
  if (organizationId) {
    const { data: org } = await supabase.from("organizations").select("topics").eq("id", organizationId).single();
    topics = org?.topics ?? [];
  }

  if (!topics || topics.length === 0) {
    return NextResponse.json({ added: 0, reason: "no topics configured" });
  }

  try {
    const { added, failedTopics } = organizationId
      ? await runDiscoveryForOwner({ organizationId, topics })
      : await runDiscoveryForOwner({ userId: user.id, topics });
    // A topic that failed to search at all (congress.gov down, rate
    // limited, bad key) looks identical to "genuinely no matches" unless
    // we say so explicitly - otherwise a real outage reads to the user
    // as "checked, nothing found," which hides the actual problem.
    if (failedTopics.length > 0 && added === 0) {
      return NextResponse.json({ added: 0, searchFailed: true, failedTopics });
    }
    return NextResponse.json({ added, failedTopics });
  } catch (err) {
    console.error("immediate discovery failed", err);
    return NextResponse.json({ added: 0, error: "discovery failed" }, { status: 500 });
  }
}

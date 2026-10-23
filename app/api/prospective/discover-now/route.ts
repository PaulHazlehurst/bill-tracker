import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDiscoveryForOwner } from "@/lib/topicDiscovery";

// Without this, Vercel's short default limit could cut a multi-topic check
// off midway, which showed up as "Couldn't check right now".
export const maxDuration = 60;

// POST - runs discovery now for the signed-in user's owner (their team if
// they're on one, otherwise themselves), instead of waiting for tomorrow's
// automatic run. Returns a per-topic report so the UI can say exactly what
// happened ("telehealth: 3 new · diabetes: 12 found, all already on your
// list") rather than a bare "no new matches".
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("organization_id, topics").eq("id", user.id).single();
  let topics: string[] = profile?.topics ?? [];
  const organizationId: string | undefined = profile?.organization_id ?? undefined;
  if (organizationId) {
    const { data: org } = await supabase.from("organizations").select("topics").eq("id", organizationId).single();
    topics = org?.topics ?? [];
  }
  if (!topics || topics.length === 0) return NextResponse.json({ added: 0, reason: "no topics configured", topics: [] });

  try {
    const res = await runDiscoveryForOwner({ organizationId, userId: organizationId ? undefined : user.id, topics, budgetMs: 52_000 });
    return NextResponse.json({
      added: res.added,
      topics: res.topics,
      failedTopics: res.failedTopics,
      searchFailed: res.failedTopics.length === topics.length,
      timedOut: res.timedOut,
    });
  } catch (err) {
    console.error("immediate discovery failed", err);
    return NextResponse.json({ added: 0, error: "discovery failed" }, { status: 500 });
  }
}

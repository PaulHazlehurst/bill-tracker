import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// GET - any authenticated user can view this. It's operational metadata
// about the app's own API usage, not sensitive per-user data, and everyone
// with an account here is already a trusted teammate.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [{ data: hourRows }, { data: dayRows }, { data: snapshots }] = await Promise.all([
    admin.from("api_call_log").select("service").gte("called_at", oneHourAgo),
    admin.from("api_call_log").select("service").gte("called_at", oneDayAgo),
    admin.from("api_rate_limit_snapshot").select("*"),
  ]);

  function countBy(rows: { service: string }[] | null) {
    const counts: Record<string, number> = {};
    for (const row of rows ?? []) counts[row.service] = (counts[row.service] ?? 0) + 1;
    return counts;
  }

  return NextResponse.json({
    callsLastHour: countBy(hourRows),
    callsLast24h: countBy(dayRows),
    officialSnapshots: snapshots ?? [],
    ldaKeyConfigured: !!process.env.LDA_API_KEY,
  });
}

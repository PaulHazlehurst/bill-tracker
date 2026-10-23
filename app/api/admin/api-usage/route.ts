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

  // Counted in the database rather than by downloading rows: a plain select
  // is capped at 1,000 rows, so busy days were silently undercounted.
  const SERVICES = ["congress_gov", "govinfo_gov", "lda_gov", "federal_register", "news_feed", "rss_feed"];
  const count = async (service: string, since: string) => {
    const { count } = await admin.from("api_call_log").select("id", { count: "exact", head: true }).eq("service", service).gte("called_at", since);
    return [service, count ?? 0] as const;
  };
  const [hour, day, { data: snapshots }] = await Promise.all([
    Promise.all(SERVICES.map((s) => count(s, oneHourAgo))),
    Promise.all(SERVICES.map((s) => count(s, oneDayAgo))),
    admin.from("api_rate_limit_snapshot").select("*"),
  ]);

  return NextResponse.json({
    callsLastHour: Object.fromEntries(hour),
    callsLast24h: Object.fromEntries(day),
    officialSnapshots: snapshots ?? [],
    ldaKeyConfigured: !!process.env.LDA_API_KEY,
  });
}

import { createAdminClient } from "@/lib/supabase/server";

// Wraps fetch() for every outbound call to an external, rate-limited API
// (congress.gov, LDA.gov) so we can show real usage on the API Usage page.
//
// Two signals get captured, since only one service reliably provides both:
// 1. Every call is logged as its own row (api_call_log) - a simple, honest
//    self-count that works regardless of what the API itself reports.
// 2. If the response includes X-RateLimit-Limit/X-RateLimit-Remaining
//    headers (confirmed real for congress.gov, since it runs on api.data.gov's
//    API Umbrella platform - unconfirmed for LDA.gov), that authoritative
//    number is captured too and shown as the primary figure when available.
//
// Logging is awaited (not fire-and-forget) on purpose: this runs inside
// Vercel serverless functions, which can be frozen the moment the main
// response is sent - an un-awaited background write isn't guaranteed to
// finish. A logging failure is swallowed either way so it never breaks the
// actual feature being used.
export async function trackedFetch(url: string, options: RequestInit, service: string): Promise<Response> {
  const res = await fetch(url, options);
  try {
    const admin = createAdminClient();
    await admin.from("api_call_log").insert({ service });

    // Opportunistic cleanup so this table never grows unbounded - the usage
    // page only ever needs the last 24 hours, so nothing older than 48 is
    // worth keeping. Cheap enough to run on every call given the modest
    // volume this app generates.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await admin.from("api_call_log").delete().lt("called_at", cutoff);

    const limit = res.headers.get("x-ratelimit-limit");
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (limit !== null && remaining !== null) {
      await admin.from("api_rate_limit_snapshot").upsert({
        service,
        limit_value: Number(limit),
        remaining_value: Number(remaining),
        updated_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error(`api usage tracking failed for ${service}`, err);
  }
  return res;
}

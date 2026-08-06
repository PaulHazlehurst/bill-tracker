import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Server-side client that reads the signed-in user's session from cookies.
// Still uses the anon key and is still subject to RLS - this is NOT an
// admin client. Use in Server Components and Route Handlers.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component with no cookie write access -
            // safe to ignore since middleware.ts refreshes the session on
            // every request.
          }
        },
      },
    }
  );
}

// Bypasses Row Level Security entirely. ONLY import this into trusted,
// server-only code that never takes a user-supplied user_id from a request
// (the cron poller and notifier, which operate on shared bills/events data
// rather than a specific user's rows).
// NEVER import this into a route reachable with a client-controlled user_id.
// NEXT.js will refuse to bundle SUPABASE_SERVICE_ROLE_KEY into client code
// since it has no NEXT_PUBLIC_ prefix, but that's a safety net, not a plan -
// keep this function out of anything imported by a "use client" file.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

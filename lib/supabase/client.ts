"use client";

import { createBrowserClient } from "@supabase/ssr";

// Safe for the browser: NEXT_PUBLIC_* vars are public by design. Every
// table this touches is locked down by Row Level Security (see
// supabase/schema.sql) so the anon key alone can't read or write anything
// RLS doesn't explicitly allow.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

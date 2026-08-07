"use client";

import { createBrowserClient } from "@supabase/ssr";

const REMEMBER_ME_FLAG = "billtracker-remember-me";

// Safe for the browser: NEXT_PUBLIC_* vars are public by design. Every
// table this touches is locked down by Row Level Security (see
// supabase/schema.sql) so the anon key alone can't read or write anything
// RLS doesn't explicitly allow.
//
// By default, Supabase already keeps sessions in localStorage, which
// persists across browser restarts until you log out - that's "remember
// me" behavior out of the box. This adds the inverse: if the login page's
// "remember me" checkbox was unchecked, the session instead goes in
// sessionStorage, which clears automatically when the tab/browser closes.
export function createClient() {
  const remember = typeof window !== "undefined"
    ? window.localStorage.getItem(REMEMBER_ME_FLAG) !== "0"
    : true;

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storage: typeof window !== "undefined"
          ? (remember ? window.localStorage : window.sessionStorage)
          : undefined,
        persistSession: true,
      },
    }
  );
}

// Call this before signing in, so the session that's about to be created
// lands in the right storage from the start.
export function setRememberMe(remember: boolean) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(REMEMBER_ME_FLAG, remember ? "1" : "0");
  }
}

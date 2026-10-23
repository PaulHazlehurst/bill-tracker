"use client";

import { createBrowserClient } from "@supabase/ssr";

const REMEMBER_ME_FLAG = "billtracker-remember-me";
const ALIVE_COOKIE = "bt_alive";

// Safe for the browser: NEXT_PUBLIC_* values are public by design, and Row
// Level Security (supabase/schema.sql) is what limits what the anon key can
// touch. Sessions live in cookies, so server routes can read them.
//
// Note: an earlier version tried to implement "keep me logged in" by passing
// a custom `storage` option here. @supabase/ssr silently replaces that option
// with its own cookie storage, so the checkbox never did anything. It's now
// implemented with a browser-session cookie - see setRememberMe and
// enforceRememberMe below.
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

/** Call at log in. `false` means "sign me out when I close the browser". */
export function setRememberMe(remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMEMBER_ME_FLAG, remember ? "1" : "0");
  } catch {}
  // A cookie with no expiry lasts exactly as long as the browser session,
  // and (unlike sessionStorage) is shared by every tab.
  document.cookie = `${ALIVE_COOKIE}=1; path=/; SameSite=Lax`;
}

/**
 * Returns true if this visit should be signed out: the person chose not to
 * stay logged in and the browser has since been closed and reopened.
 */
export function shouldEndSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(REMEMBER_ME_FLAG) !== "0") return false;
  } catch {
    return false;
  }
  return !document.cookie.split("; ").some((c) => c.startsWith(`${ALIVE_COOKIE}=`));
}

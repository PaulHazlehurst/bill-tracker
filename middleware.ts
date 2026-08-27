import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Refreshes the Supabase auth session on every request and blocks
// unauthenticated access to protected pages before they render.
//
// Resilience note: the auth check below makes a network call to Supabase on
// every request. On the free tier the project idles when unused and, on the
// first request after a quiet spell, can take several seconds to wake - long
// enough that Vercel kills the entire middleware invocation with a 504
// (MIDDLEWARE_INVOCATION_TIMEOUT), which takes the whole page down until you
// refresh. To prevent that, we cap the auth check with a short timeout and
// "fail open": if Supabase doesn't answer in time, we treat auth as UNKNOWN
// (not "logged out") and let the request through, rather than either 504-ing
// or wrongly bouncing a logged-in person to /login. Every page already does
// its own client-side auth guard and every table is protected by row-level
// security, so nothing sensitive is exposed by letting the request proceed.
const AUTH_CHECK_TIMEOUT_MS = 3500;

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // Race the auth lookup against a timeout. `authKnown` stays false if the
  // lookup is too slow (or errors), so we only ever redirect when we have a
  // definite "no user" answer - never on a slow/waking backend.
  let authKnown = false;
  let user: unknown = null;
  try {
    const outcome = await Promise.race([
      supabase.auth.getUser().then((res) => ({ timedOut: false as const, res })),
      new Promise<{ timedOut: true }>((resolve) =>
        setTimeout(() => resolve({ timedOut: true }), AUTH_CHECK_TIMEOUT_MS)
      ),
    ]);
    if (!outcome.timedOut) {
      authKnown = true;
      user = outcome.res.data.user;
    }
  } catch {
    authKnown = false;
  }

  const protectedPaths = ["/dashboard", "/team", "/bill", "/activity", "/settings", "/api-usage", "/compare", "/statistics", "/rural-health", "/members"];
  const isProtected = protectedPaths.some((p) => request.nextUrl.pathname.startsWith(p));

  // Redirect only when we KNOW the visitor is signed out. A timed-out check
  // (authKnown === false) falls through to the page, which guards itself.
  if (isProtected && authKnown && !user) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/team/:path*", "/bill/:path*", "/activity/:path*", "/settings/:path*", "/api-usage/:path*", "/compare/:path*", "/statistics/:path*", "/rural-health/:path*", "/members/:path*"],
};

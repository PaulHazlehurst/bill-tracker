// A signed-in session for the made-up user in e2e/mock/fixtures.py, in the
// cookie format @supabase/ssr reads. The stand-in database doesn't check
// signatures, so this never works against a real Supabase project.
const b64u = (s) => Buffer.from(s).toString("base64url");

export function sessionCookie() {
  const exp = Math.floor(Date.now() / 1000) + 86_400;
  const user = { id: "11111111-1111-1111-1111-111111111111", aud: "authenticated", role: "authenticated", email: "ben@pinnaclestrategies.com" };
  const jwt = [b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), b64u(JSON.stringify({ sub: user.id, exp, role: "authenticated", aud: "authenticated", email: user.email })), "sig"].join(".");
  const session = { access_token: jwt, refresh_token: "r", expires_at: exp, expires_in: 86_400, token_type: "bearer", user };
  // The cookie is named after the first part of the database's host name (127.0.0.1).
  return { name: "sb-127-auth-token", value: "base64-" + b64u(JSON.stringify(session)) };
}

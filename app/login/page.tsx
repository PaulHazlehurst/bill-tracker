"use client";

// These pages depend on the signed-in user's session, which only exists at
// request time in the browser - there's no sensible static/build-time version
// of them. This tells Next.js to render on each request instead of trying to
// pre-build static HTML (which would run before any Supabase session exists).
export const dynamic = "force-dynamic";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, setRememberMe } from "@/lib/supabase/client";
import AuthShell from "@/components/auth/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Set this BEFORE creating the client that actually signs in, so the
    // resulting session is written to the right storage from the start.
    setRememberMe(remember);
    const supabase = createClient();

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message === "Invalid login credentials" ? "That email and password don't match. Check them and try again." : signInError.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <AuthShell
      title="Log in"
      subtitle="Welcome back. Your bills were checked this morning."
      footer={<>New here? <Link href="/signup">Create an account</Link></>}
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <div className="field-row">
            <label htmlFor="password">Password</label>
            <Link href="/reset-password" className="field-link">Forgot it?</Link>
          </div>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <label className="check-row">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me logged in on this device
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={loading}>
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthShell>
  );
}

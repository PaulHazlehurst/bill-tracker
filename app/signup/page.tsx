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

type TeamMode = "none" | "create" | "join";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [teamMode, setTeamMode] = useState<TeamMode>("none");
  const [newOrgName, setNewOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    setRememberMe(true);
    const supabase = createClient();

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError || !data.user) {
      setError(signUpError?.message ?? "Sign up failed");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/complete-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: data.user.id,
        email,
        phone: phone.trim() || null,
        teamMode,
        newOrgName: teamMode === "create" ? newOrgName.trim() : null,
        inviteCode: teamMode === "join" ? inviteCode.trim() : null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        data.session
          ? body.error ?? "Account created, but team setup failed"
          : "Account created - check your email to confirm, then log in to finish setup."
      );
      setLoading(false);
      return;
    }

    if (!data.session) {
      setError("Account created! Check your email to confirm, then log in.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Track bills, set positions, and get alerted when they move. Free to start."
      footer={<>Already have an account? <Link href="/login">Log in</Link></>}
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="field-hint">At least 8 characters.</span>
        </div>
        <div className="field">
          <label htmlFor="phone">Mobile number <span className="field-optional">optional, for text alerts</span></label>
          <input id="phone" type="tel" autoComplete="tel" placeholder="+1 410 555 0123" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        <div className="field">
          <label>Team</label>
          <div className="seg seg-full" role="group" aria-label="Team">
            <button type="button" className={teamMode === "none" ? "is-on" : ""} onClick={() => setTeamMode("none")}>Not now</button>
            <button type="button" className={teamMode === "create" ? "is-on" : ""} onClick={() => setTeamMode("create")}>Start a team</button>
            <button type="button" className={teamMode === "join" ? "is-on" : ""} onClick={() => setTeamMode("join")}>Join a team</button>
          </div>
        </div>

        {teamMode === "create" && (
          <div className="field">
            <label htmlFor="newOrg">Team name</label>
            <input id="newOrg" required value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} />
            <span className="field-hint">You'll get an invite code to share with teammates.</span>
          </div>
        )}
        {teamMode === "join" && (
          <div className="field">
            <label htmlFor="inviteCode">Invite code</label>
            <input id="inviteCode" required value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} className="input-code" placeholder="A1B2C3D4" />
            <span className="field-hint">Ask someone already on the team for it.</span>
          </div>
        )}

        <label className="check-row">
          <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)} />
          <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
        </label>
        {error && <p className={error.startsWith("Account created") ? "notice" : "error-text"}>{error}</p>}
        <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={loading || !agreedToTerms}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}

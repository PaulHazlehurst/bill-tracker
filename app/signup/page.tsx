"use client";

// These pages depend on the signed-in user's session, which only exists at
// request time in the browser - there's no sensible static/build-time version
// of them. This tells Next.js to render on each request instead of trying to
// pre-build static HTML (which would run before any Supabase session exists).
export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, setRememberMe } from "@/lib/supabase/client";

type TeamMode = "none" | "create" | "join";

export default function SignupPage() {
  const supabase = createClient();
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
    <div className="container" style={{ maxWidth: 420 }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 500 }}>Create your account</h1>
      <form onSubmit={handleSubmit} className="card">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone (optional, for text alerts)</label>
          <input id="phone" type="tel" placeholder="+1 555 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        <div className="field">
          <label>Team</label>
          <div className="segmented">
            <button type="button" className={teamMode === "none" ? "segmented-active" : ""} onClick={() => setTeamMode("none")}>Skip for now</button>
            <button type="button" className={teamMode === "create" ? "segmented-active" : ""} onClick={() => setTeamMode("create")}>Create a team</button>
            <button type="button" className={teamMode === "join" ? "segmented-active" : ""} onClick={() => setTeamMode("join")}>Join a team</button>
          </div>
        </div>

        {teamMode === "create" && (
          <div className="field">
            <label htmlFor="newOrg">Team name</label>
            <input id="newOrg" required value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} />
            <p className="muted" style={{ margin: "2px 0 0" }}>You'll be able to invite teammates with a code after signing up.</p>
          </div>
        )}
        {teamMode === "join" && (
          <div className="field">
            <label htmlFor="inviteCode">Invite code</label>
            <input id="inviteCode" required value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} style={{ textTransform: "uppercase" }} placeholder="e.g. A1B2C3D4" />
            <p className="muted" style={{ margin: "2px 0 0" }}>Get this from someone already on the team.</p>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: '0.8125rem', marginBottom: 16, marginTop: 4 }}>
          <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)} style={{ marginTop: 2 }} />
          <span>I agree to the <a href="/terms" target="_blank">Terms of Service</a> and <a href="/privacy" target="_blank">Privacy Policy</a>.</span>
        </label>
        <button className="primary" type="submit" disabled={loading || !agreedToTerms}>
          {loading ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p className="muted">Already have an account? <a href="/login">Log in</a></p>
    </div>
  );
}

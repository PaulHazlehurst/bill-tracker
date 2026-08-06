"use client";

// These pages depend on the signed-in user's session, which only exists at
// request time in the browser - there's no sensible static/build-time version
// of them. This tells Next.js to render on each request instead of trying to
// pre-build static HTML (which would run before any Supabase session exists).
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Org = { id: string; name: string };

export default function SignupPage() {
  const supabase = createClient();
  const router = useRouter();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [orgChoice, setOrgChoice] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from("organizations").select("id, name").order("name").then(({ data }) => {
      if (data) setOrgs(data);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

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
        organizationId: orgChoice && orgChoice !== "__new__" ? orgChoice : null,
        newOrgName: orgChoice === "__new__" ? newOrgName.trim() : null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        data.session
          ? body.error ?? "Account created, but profile setup failed"
          : "Account created - check your email to confirm, then log in to finish setup."
      );
      setLoading(false);
      return;
    }

    if (!data.session) {
      // Email confirmation is required - there's no session yet to send
      // them to the dashboard with.
      setError("Account created! Check your email to confirm, then log in.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>Create your account</h1>
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
          <label htmlFor="org">Organization</label>
          <select id="org" value={orgChoice} onChange={(e) => setOrgChoice(e.target.value)}>
            <option value="">No organization (personal only)</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
            <option value="__new__">+ Create a new organization</option>
          </select>
        </div>
        {orgChoice === "__new__" && (
          <div className="field">
            <label htmlFor="newOrg">New organization name</label>
            <input id="newOrg" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} />
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p className="muted">Already have an account? <a href="/login">Log in</a></p>
    </div>
  );
}

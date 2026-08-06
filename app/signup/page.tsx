"use client";

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

    let organizationId = orgChoice || null;
    if (orgChoice === "__new__" && newOrgName.trim()) {
      const { data: newOrg, error: orgErr } = await supabase
        .from("organizations")
        .insert({ name: newOrgName.trim() })
        .select("id")
        .single();
      if (orgErr) {
        setError("Could not create organization: " + orgErr.message);
        setLoading(false);
        return;
      }
      organizationId = newOrg.id;
    }

    const { error: profileErr } = await supabase.from("profiles").insert({
      id: data.user.id,
      email,
      phone: phone.trim() || null,
      organization_id: organizationId,
    });

    if (profileErr) {
      setError("Account created, but profile setup failed: " + profileErr.message);
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

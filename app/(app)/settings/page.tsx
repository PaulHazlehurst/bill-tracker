"use client";

// Session-dependent, same reasoning as the other authenticated pages.
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import FontSizeSwitcher from "@/components/FontSizeSwitcher";
import Spinner from "@/components/Spinner";

type Org = { id: string; name: string };

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [orgId, setOrgId] = useState<string>("");
  const [orgChoice, setOrgChoice] = useState<string>("");
  const [newOrgName, setNewOrgName] = useState("");
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setEmail(user.email ?? null);

      const [{ data: profile }, { data: orgList }] = await Promise.all([
        supabase.from("profiles").select("phone, organization_id").eq("id", user.id).single(),
        supabase.from("organizations").select("id, name").order("name"),
      ]);

      setPhone(profile?.phone ?? "");
      setOrgId(profile?.organization_id ?? "");
      setOrgChoice(profile?.organization_id ?? "");
      setOrgs((orgList as Org[]) ?? []);
      setLoading(false);
    })();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Basic sanity check, not full E.164 validation - good enough to catch
    // obvious typos before they silently break SMS delivery later.
    if (phone.trim() && !/^\+?[0-9\s()-]{7,20}$/.test(phone.trim())) {
      setError("That doesn't look like a valid phone number.");
      setSaving(false);
      return;
    }

    let finalOrgId: string | null = orgChoice || null;
    if (orgChoice === "__new__" && newOrgName.trim()) {
      const { data: newOrg, error: orgError } = await supabase
        .from("organizations")
        .insert({ name: newOrgName.trim() })
        .select("id")
        .single();
      if (orgError) {
        setError("Could not create organization: " + orgError.message);
        setSaving(false);
        return;
      }
      finalOrgId = newOrg.id;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ phone: phone.trim() || null, organization_id: finalOrgId })
      .eq("id", user.id);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setOrgId(finalOrgId ?? "");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="container-wide" style={{ maxWidth: 620 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 500, marginBottom: 24 }}>Settings</h1>

        {loading ? (
          <Spinner label="Loading settings…" />
        ) : (
          <>
            <div className="settings-section">
              <h2>Appearance</h2>
              <p className="settings-desc">Choose a color theme. Applies immediately and is remembered on this device.</p>
              <ThemeSwitcher />
            </div>

            <div className="settings-section">
              <h2>Text size</h2>
              <p className="settings-desc">Adjust the size of text throughout the app.</p>
              <FontSizeSwitcher />
            </div>

            <div className="settings-section">
              <h2>Account</h2>
              <form onSubmit={handleSave} className="card">
                <div className="field">
                  <label>Email</label>
                  <div>{email}</div>
                  <p className="muted" style={{ margin: "2px 0 0" }}>Contact support to change your email for now.</p>
                </div>

                <div className="field">
                  <label htmlFor="phone">Phone number (for text alerts)</label>
                  <input
                    id="phone"
                    type="tel"
                    placeholder="+1 410 555 1234"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>

                <div className="field" style={{ marginBottom: orgChoice === "__new__" ? 10 : 16 }}>
                  <label htmlFor="org">Organization</label>
                  <select id="org" value={orgChoice} onChange={(e) => setOrgChoice(e.target.value)}>
                    <option value="">No organization</option>
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
                {orgId && orgChoice !== orgId && (
                  <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
                    Changing teams: bills you already tracked stay associated with your previous team's view - only newly tracked bills follow this change.
                  </p>
                )}

                {error && <p className="error-text">{error}</p>}
                {saved && <p className="muted" style={{ color: "var(--accent)" }}>Saved.</p>}
                <button className="primary" type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </form>
            </div>
          </>
        )}
    </div>
  );
}

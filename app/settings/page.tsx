"use client";

// Session-dependent, same reasoning as the other authenticated pages.
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NavBar from "@/components/NavBar";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import FontSizeSwitcher from "@/components/FontSizeSwitcher";
import Spinner from "@/components/Spinner";

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setEmail(user.email ?? null);

      const { data: profile } = await supabase
        .from("profiles")
        .select("organizations(name)")
        .eq("id", user.id)
        .single();
      const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
      setOrgName((org as any)?.name ?? null);

      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <NavBar />
      <div className="container" style={{ maxWidth: 620 }}>
        <h1 style={{ fontSize: "1.375rem", fontWeight: 500, marginBottom: 24 }}>Settings</h1>

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
              <div className="card">
                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Email</label>
                  <div>{email}</div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Organization</label>
                  <div>{orgName ?? "No organization"}</div>
                </div>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                To change your email, phone number, or organization, contact support for now - self-service editing isn't built yet.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

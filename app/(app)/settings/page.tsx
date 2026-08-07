"use client";

// Session-dependent, same reasoning as the other authenticated pages.
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import FontSizeSwitcher from "@/components/FontSizeSwitcher";
import DensitySwitcher from "@/components/DensitySwitcher";
import Spinner from "@/components/Spinner";

type TeamMode = "none" | "create" | "join";

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [defaultNotifyEmail, setDefaultNotifyEmail] = useState(true);
  const [defaultNotifySms, setDefaultNotifySms] = useState(false);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const [teamMode, setTeamMode] = useState<TeamMode>("none");
  const [newOrgName, setNewOrgName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    setUserId(user.id);
    setEmail(user.email ?? null);

    const { data: profile } = await supabase
      .from("profiles")
      .select("phone, organization_id, default_notify_email, default_notify_sms, organizations(name, invite_code, created_by)")
      .eq("id", user.id)
      .single();

    setPhone(profile?.phone ?? "");
    setDefaultNotifyEmail(profile?.default_notify_email ?? true);
    setDefaultNotifySms(profile?.default_notify_sms ?? false);
    setOrgId(profile?.organization_id ?? null);

    const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
    setOrgName((org as any)?.name ?? "");
    setInviteCode((org as any)?.invite_code ?? null);
    setIsOwner((org as any)?.created_by === user.id);

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    if (phone.trim() && !/^\+?[0-9\s()-]{7,20}$/.test(phone.trim())) {
      setError("That doesn't look like a valid phone number.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        phone: phone.trim() || null,
        default_notify_email: defaultNotifyEmail,
        default_notify_sms: defaultNotifySms,
      })
      .eq("id", userId);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    setTeamBusy(true);
    setTeamError(null);
    const { data: newOrg, error: orgErr } = await supabase
      .from("organizations")
      .insert({ name: newOrgName.trim(), created_by: userId })
      .select("id")
      .single();
    if (orgErr) {
      setTeamError(orgErr.code === "23505" ? "A team with that name already exists." : orgErr.message);
      setTeamBusy(false);
      return;
    }
    await supabase.from("profiles").update({ organization_id: newOrg.id }).eq("id", userId);
    setTeamBusy(false);
    setTeamMode("none");
    load();
  }

  async function handleJoinTeam(e: React.FormEvent) {
    e.preventDefault();
    setTeamBusy(true);
    setTeamError(null);
    const { data: org, error: findErr } = await supabase
      .from("organizations")
      .select("id")
      .eq("invite_code", joinCode.trim().toUpperCase())
      .maybeSingle();
    if (findErr || !org) {
      setTeamError("That invite code doesn't match any team.");
      setTeamBusy(false);
      return;
    }
    const { error: joinErr } = await supabase.from("profiles").update({ organization_id: org.id }).eq("id", userId);
    setTeamBusy(false);
    if (joinErr) {
      setTeamError(joinErr.message);
      return;
    }
    setTeamMode("none");
    load();
  }

  async function handleLeaveTeam() {
    if (!window.confirm(isOwner
      ? "You're the owner - leaving means the team keeps going without an owner (no one will be able to rename it or manage members). Leave anyway?"
      : "Leave this team?")) return;
    setTeamBusy(true);
    await supabase.from("profiles").update({ organization_id: null }).eq("id", userId);
    setTeamBusy(false);
    load();
  }

  async function handleRenameTeam(e: React.FormEvent) {
    e.preventDefault();
    setTeamBusy(true);
    setTeamError(null);
    const { error: renameErr } = await supabase.from("organizations").update({ name: orgName.trim() }).eq("id", orgId);
    setTeamBusy(false);
    if (renameErr) {
      setTeamError(renameErr.message.includes("owner") ? renameErr.message : "Could not rename: " + renameErr.message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleRegenerateCode() {
    if (!window.confirm("Generate a new invite code? The old code will stop working.")) return;
    setTeamBusy(true);
    setTeamError(null);
    const newCode = Math.random().toString(36).slice(2, 10).toUpperCase();
    const { error: regenErr } = await supabase.from("organizations").update({ invite_code: newCode }).eq("id", orgId);
    setTeamBusy(false);
    if (regenErr) {
      setTeamError("Could not regenerate code: " + regenErr.message);
      return;
    }
    setInviteCode(newCode);
  }

  function copyCode() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1800);
    });
  }

  return (
    <div className="container-wide" style={{ maxWidth: 640 }}>
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
            <h2>Table density</h2>
            <p className="settings-desc">Compact fits more rows on screen at once.</p>
            <DensitySwitcher />
          </div>

          <div className="settings-section">
            <h2>Account</h2>
            <form onSubmit={handleSaveAccount} className="card">
              <div className="field">
                <label>Email</label>
                <div>{email}</div>
                <p className="muted" style={{ margin: "2px 0 0" }}>Contact support to change your email for now.</p>
              </div>
              <div className="field">
                <label htmlFor="phone">Phone number (for text alerts)</label>
                <input id="phone" type="tel" placeholder="+1 410 555 1234" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>Default notifications for newly tracked bills</label>
              </div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: '0.8125rem' }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={defaultNotifyEmail} onChange={(e) => setDefaultNotifyEmail(e.target.checked)} />
                  Email me by default
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={defaultNotifySms} onChange={(e) => setDefaultNotifySms(e.target.checked)} />
                  Text me by default
                </label>
              </div>
              {error && <p className="error-text">{error}</p>}
              {saved && <p className="muted" style={{ color: "var(--accent)" }}>Saved.</p>}
              <button className="primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </form>
          </div>

          <div className="settings-section">
            <h2>Team</h2>

            {orgId ? (
              <div className="card">
                {isOwner ? (
                  <form onSubmit={handleRenameTeam} className="field" style={{ marginBottom: 16 }}>
                    <label htmlFor="orgName">Team name <span className="muted">(you're the owner)</span></label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} style={{ flex: 1 }} />
                      <button className="ghost" type="submit" disabled={teamBusy}>Rename</button>
                    </div>
                  </form>
                ) : (
                  <div className="field" style={{ marginBottom: 16 }}>
                    <label>Team name</label>
                    <div>{orgName}</div>
                  </div>
                )}

                <div className="field" style={{ marginBottom: 16 }}>
                  <label>Invite code</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <code className="invite-code">{inviteCode}</code>
                    <button className="ghost" type="button" onClick={copyCode}>{codeCopied ? "Copied" : "Copy"}</button>
                    {isOwner && <button className="ghost" type="button" onClick={handleRegenerateCode} disabled={teamBusy}>Regenerate</button>}
                  </div>
                  <p className="muted" style={{ margin: "2px 0 0" }}>Share this with anyone you want to join your team.</p>
                </div>

                {teamError && <p className="error-text">{teamError}</p>}
                <button className="ghost" onClick={handleLeaveTeam} disabled={teamBusy}>Leave team</button>
              </div>
            ) : (
              <div className="card">
                <div className="segmented" style={{ marginBottom: 16 }}>
                  <button type="button" className={teamMode === "none" ? "segmented-active" : ""} onClick={() => setTeamMode("none")}>Not now</button>
                  <button type="button" className={teamMode === "create" ? "segmented-active" : ""} onClick={() => setTeamMode("create")}>Create a team</button>
                  <button type="button" className={teamMode === "join" ? "segmented-active" : ""} onClick={() => setTeamMode("join")}>Join a team</button>
                </div>

                {teamMode === "create" && (
                  <form onSubmit={handleCreateTeam} className="field">
                    <label htmlFor="newTeam">Team name</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input id="newTeam" required value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} style={{ flex: 1 }} />
                      <button className="primary" type="submit" disabled={teamBusy}>Create</button>
                    </div>
                  </form>
                )}
                {teamMode === "join" && (
                  <form onSubmit={handleJoinTeam} className="field">
                    <label htmlFor="joinCode">Invite code</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input id="joinCode" required value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} style={{ flex: 1, textTransform: "uppercase" }} />
                      <button className="primary" type="submit" disabled={teamBusy}>Join</button>
                    </div>
                  </form>
                )}
                {teamError && <p className="error-text">{teamError}</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

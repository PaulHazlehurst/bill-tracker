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
import { useUI } from "@/components/UIProvider";
import { useSession } from "@/components/SessionProvider";
import PageHeader from "@/components/ui/PageHeader";
import Link from "next/link";

type TeamMode = "none" | "create" | "join";

// Defined outside the page component on purpose: a component declared
// inside another is recreated every render, which remounts its inputs and
// drops focus after each keystroke.
function Row({ title, desc, children }: { title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <h3>{title}</h3>
        {desc && <p>{desc}</p>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}


export default function SettingsPage() {
  const supabase = createClient();
  const { toast, confirm } = useUI();
  const { refresh: refreshSession } = useSession();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [defaultNotifyEmail, setDefaultNotifyEmail] = useState(true);
  const [defaultNotifySms, setDefaultNotifySms] = useState(false);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [topics, setTopics] = useState("");
  const [savingTopics, setSavingTopics] = useState(false);
  const [topicsSaved, setTopicsSaved] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);

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

    const { data: profile, error: loadError } = await supabase
      .from("profiles")
      .select("phone, organization_id, default_notify_email, default_notify_sms, email_notifications_enabled, topics, organizations(name, invite_code, created_by, topics)")
      .eq("id", user.id)
      .single();

    if (loadError) {
      console.error("failed to load settings", loadError);
      setError(loadError.message);
      setLoading(false);
      return;
    }

    setPhone(profile?.phone ?? "");
    setDefaultNotifyEmail(profile?.default_notify_email ?? true);
    setDefaultNotifySms(profile?.default_notify_sms ?? false);
    setEmailNotificationsEnabled(profile?.email_notifications_enabled ?? false);
    setOrgId(profile?.organization_id ?? null);

    const org = Array.isArray(profile?.organizations) ? profile?.organizations[0] : profile?.organizations;
    setOrgName((org as any)?.name ?? "");
    setInviteCode((org as any)?.invite_code ?? null);
    setIsOwner((org as any)?.created_by === user.id);
    setTopics((profile?.organization_id ? (org as any)?.topics : profile?.topics)?.join(", ") ?? "");

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
        email_notifications_enabled: emailNotificationsEnabled,
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

  async function handleSaveTopics(e: React.FormEvent) {
    e.preventDefault();
    setSavingTopics(true);
    setTopicsError(null);
    setTopicsSaved(false);

    const cleanTopics = topics.split(",").map((t) => t.trim()).filter(Boolean);

    // Org topics are shared (anyone on the team can set them, per the
    // schema's update-permission trigger) - personal topics only apply
    // when there's no team yet.
    const { error: updateError2 } = orgId
      ? await supabase.from("organizations").update({ topics: cleanTopics }).eq("id", orgId)
      : await supabase.from("profiles").update({ topics: cleanTopics }).eq("id", userId);

    setSavingTopics(false);
    if (updateError2) {
      setTopicsError(updateError2.message);
      return;
    }
    setTopicsSaved(true);
    setTimeout(() => setTopicsSaved(false), 2500);
    refreshSession();

    // Best-effort - if this is the first time topics are set, don't make
    // someone wait until tomorrow's cron to see anything.
    fetch("/api/prospective/discover-now", { method: "POST" }).catch(() => {});
  }

  async function handleSendTestEmail() {
    setSendingTest(true);
    const res = await fetch("/api/test-email", { method: "POST" });
    setSendingTest(false);
    if (res.ok) {
      toast("Test email sent - check your inbox", "success");
    } else {
      const body = await res.json().catch(() => ({}));
      toast(body.error ?? "Couldn't send test email", "error");
    }
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
    const { error: linkErr } = await supabase.from("profiles").update({ organization_id: newOrg.id }).eq("id", userId);
    setTeamBusy(false);
    if (linkErr) {
      setTeamError("The team was created, but we couldn't add you to it: " + linkErr.message);
      return;
    }
    setTeamMode("none");
    load();
    refreshSession();
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
    if (findErr) {
      console.error("invite code lookup failed", findErr);
      setTeamError("Couldn't look up that code: " + findErr.message);
      setTeamBusy(false);
      return;
    }
    if (!org) {
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
    refreshSession();
  }

  async function handleLeaveTeam() {
    const ok = await confirm(
      isOwner
        ? "You're the owner - leaving means the team keeps going without an owner (no one will be able to rename it or manage members). Leave anyway?"
        : "Leave this team?",
      { confirmLabel: "Leave team", danger: true }
    );
    if (!ok) return;
    setTeamBusy(true);
    await supabase.from("profiles").update({ organization_id: null }).eq("id", userId);
    setTeamBusy(false);
    toast("Left the team", "info");
    load();
    refreshSession();
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
    refreshSession();
  }

  async function handleRegenerateCode() {
    if (!(await confirm("Generate a new invite code? The old code will stop working.", { confirmLabel: "Regenerate" }))) return;
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
    toast("New invite code generated", "success");
  }

  function copyCode() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1800);
    });
  }

  return (
    <div className="page settings">
      <PageHeader title="Settings" description="Alerts, your team, and how the app looks on this device." />

      {loading ? (
        <Spinner label="Loading settings…" />
      ) : error && !email ? (
        <p className="error-text">Couldn't load settings: {error}</p>
      ) : (
        <>
          <section className="set-section">
            <h2 className="set-title">Alerts</h2>
            <form onSubmit={handleSaveAccount}>
              <Row title="Email alerts" desc="One summary email on mornings when bills you follow change. Off until you turn it on.">
                <label className="switch-row">
                  <input type="checkbox" className="switch" checked={emailNotificationsEnabled} onChange={(e) => setEmailNotificationsEnabled(e.target.checked)} />
                  <span>{emailNotificationsEnabled ? "On" : "Off"}</span>
                </label>
              </Row>
              <Row title="Mobile number" desc="Needed for text alerts. Texts only go out for bills where you've turned text alerts on.">
                <input id="phone" type="tel" className="input" placeholder="+1 410 555 0123" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Mobile number" />
              </Row>
              <Row title="For bills you track from now on" desc="You can change alerts for any single bill from its menu.">
                <div className="stack-sm">
                  <label className="check-row"><input type="checkbox" checked={defaultNotifyEmail} onChange={(e) => setDefaultNotifyEmail(e.target.checked)} /> Email me</label>
                  <label className="check-row"><input type="checkbox" checked={defaultNotifySms} onChange={(e) => setDefaultNotifySms(e.target.checked)} /> Text me</label>
                </div>
              </Row>
              <div className="set-actions">
                {error && <p className="error-text">{error}</p>}
                {saved && <p className="saved-text">Saved</p>}
                <button className="btn btn-ghost" type="button" onClick={handleSendTestEmail} disabled={sendingTest}>{sendingTest ? "Sending…" : "Send me a test email"}</button>
                <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save alert settings"}</button>
              </div>
            </form>
          </section>

          <section className="set-section">
            <h2 className="set-title">Topics</h2>
            <form onSubmit={handleSaveTopics}>
              <Row
                title={orgId ? "Your team's topics" : "Your topics"}
                desc={<>{orgId ? "Shared with everyone on your team." : "Just for you until you join a team."} Each morning we suggest new bills that match. You can also manage these, and preview what a topic finds, in <Link href="/dashboard">Discover</Link>.</>}
              >
                <textarea id="topics" className="input" rows={3} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="telehealth, critical access hospital, 340B" aria-label="Topics, separated by commas" />
                <span className="field-hint">Separate topics with commas.</span>
              </Row>
              <div className="set-actions">
                {topicsError && <p className="error-text">{topicsError}</p>}
                {topicsSaved && <p className="saved-text">Saved. Checking for matching bills now.</p>}
                <button className="btn btn-primary" type="submit" disabled={savingTopics}>{savingTopics ? "Saving…" : "Save topics"}</button>
              </div>
            </form>
          </section>

          <section className="set-section">
            <h2 className="set-title">Team</h2>
            {orgId ? (
              <>
                <Row title="Team name" desc={isOwner ? "You created this team, so you can rename it." : "Only the person who created the team can rename it."}>
                  {isOwner ? (
                    <form onSubmit={handleRenameTeam} className="inline-form">
                      <input id="orgName" className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} aria-label="Team name" />
                      <button className="btn btn-secondary" type="submit" disabled={teamBusy}>Rename</button>
                    </form>
                  ) : (
                    <strong>{orgName}</strong>
                  )}
                </Row>
                <Row title="Invite code" desc="Anyone with this code can join your team at sign up or from their settings.">
                  <div className="inline-form">
                    <code className="invite-code">{inviteCode}</code>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={copyCode}>{codeCopied ? "Copied" : "Copy"}</button>
                    {isOwner && <button className="btn btn-ghost btn-sm" type="button" onClick={handleRegenerateCode} disabled={teamBusy}>New code</button>}
                  </div>
                </Row>
                <Row title="Leave this team" desc="Your tracked bills stay with you. You'll stop seeing your teammates' bills.">
                  <button className="btn btn-secondary btn-danger-text" onClick={handleLeaveTeam} disabled={teamBusy}>Leave team</button>
                </Row>
                {teamError && <p className="error-text">{teamError}</p>}
              </>
            ) : (
              <Row title="Work with a team" desc="Teammates share topics, see each other's bills and positions, and get a shared task board.">
                <div className="seg" role="group" aria-label="Team">
                  <button type="button" className={teamMode === "create" ? "is-on" : ""} onClick={() => setTeamMode("create")}>Start a team</button>
                  <button type="button" className={teamMode === "join" ? "is-on" : ""} onClick={() => setTeamMode("join")}>Join with a code</button>
                </div>
                {teamMode === "create" && (
                  <form onSubmit={handleCreateTeam} className="inline-form">
                    <input id="newTeam" className="input" required placeholder="Team name" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} aria-label="Team name" />
                    <button className="btn btn-primary" type="submit" disabled={teamBusy}>Create</button>
                  </form>
                )}
                {teamMode === "join" && (
                  <form onSubmit={handleJoinTeam} className="inline-form">
                    <input id="joinCode" className="input input-code" required placeholder="Invite code" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} aria-label="Invite code" />
                    <button className="btn btn-primary" type="submit" disabled={teamBusy}>Join</button>
                  </form>
                )}
                {teamError && <p className="error-text">{teamError}</p>}
              </Row>
            )}
          </section>

          <section className="set-section">
            <h2 className="set-title">Appearance</h2>
            <Row title="Theme" desc="Remembered on this device."><ThemeSwitcher /></Row>
            <Row title="Text size"><FontSizeSwitcher /></Row>
            <Row title="List density" desc="Compact fits more bills on screen."><DensitySwitcher /></Row>
          </section>

          <section className="set-section">
            <h2 className="set-title">Account</h2>
            <Row title="Email" desc="Contact your administrator to change the email on your account.">
              <strong>{email}</strong>
            </Row>
          </section>
        </>
      )}
    </div>
  );
}

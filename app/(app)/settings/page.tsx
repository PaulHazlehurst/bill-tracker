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
import { Mail, MessageSquare } from "lucide-react";
import PushControls from "@/components/PushControls";
import { normalizePhone } from "@/lib/phone";

type TeamMode = "none" | "create" | "join";
type AlertStatus = { email: boolean; emailFrom: string | null; sms: boolean };


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
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [defaultNotifyEmail, setDefaultNotifyEmail] = useState(true);
  const [defaultNotifySms, setDefaultNotifySms] = useState(false);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(false);
  const [notifyPush, setNotifyPush] = useState(true);
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [sendingTest, setSendingTest] = useState<"email" | "sms" | null>(null);
  const [topics, setTopics] = useState("");
  const [savingTopics, setSavingTopics] = useState(false);
  const [topicsSaved, setTopicsSaved] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [teamRole, setTeamRole] = useState<string>("member");

  const [teamMode, setTeamMode] = useState<TeamMode>("none");
  const [newOrgName, setNewOrgName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);
  // Names, roles and push need database update 0007; until then those parts stay hidden.
  const [hasTeamFeatures, setHasTeamFeatures] = useState(true);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    setUserId(user.id);
    setEmail(user.email ?? null);
    fetch("/api/alerts/status").then((r) => (r.ok ? r.json() : null)).then(setStatus).catch(() => {});

    const base = "phone, organization_id, default_notify_email, default_notify_sms, email_notifications_enabled, topics, organizations(name, created_by, topics)";
    let { data: profile, error: loadError } = await supabase.from("profiles").select(`${base}, full_name, job_title, team_role, notify_push`).eq("id", user.id).single();
    if (loadError) {
      setHasTeamFeatures(false);
      ({ data: profile, error: loadError } = await supabase.from("profiles").select(base).eq("id", user.id).single() as any);
    }

    if (loadError) {
      console.error("failed to load settings", loadError);
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const p = profile as any;
    setFullName(p?.full_name ?? "");
    setJobTitle(p?.job_title ?? "");
    setPhone(p?.phone ?? "");
    setDefaultNotifyEmail(p?.default_notify_email ?? true);
    setDefaultNotifySms(p?.default_notify_sms ?? false);
    setEmailNotificationsEnabled(p?.email_notifications_enabled ?? false);
    setNotifyPush(p?.notify_push ?? true);
    setOrgId(p?.organization_id ?? null);

    const org = Array.isArray(p?.organizations) ? p?.organizations[0] : p?.organizations;
    setOrgName(org?.name ?? "");
    setTeamRole(org?.created_by === user.id ? "owner" : p?.team_role ?? "member");
    setTopics((p?.organization_id ? org?.topics : p?.topics)?.join(", ") ?? "");

    setLoading(false);
  }

  useEffect(() => {
    load();
    // Opened from the bell's "Alert settings": jump to that section.
    if (window.location.hash === "#notifications") setTimeout(() => document.getElementById("notifications")?.scrollIntoView({ block: "start" }), 300);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const cleanPhone = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !cleanPhone) {
      setError("That doesn't look like a mobile number. Use a 10-digit US number, or start with + and the country code.");
      setSaving(false);
      return;
    }

    const update: Record<string, unknown> = {
      phone: cleanPhone,
      default_notify_email: defaultNotifyEmail,
      default_notify_sms: defaultNotifySms,
      email_notifications_enabled: emailNotificationsEnabled,
    };
    if (hasTeamFeatures) Object.assign(update, { full_name: fullName.trim() || null, job_title: jobTitle.trim() || null, notify_push: notifyPush });
    const { error: updateError } = await supabase.from("profiles").update(update).eq("id", userId);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (cleanPhone) setPhone(cleanPhone);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    refreshSession();
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

  async function sendTest(kind: "email" | "sms") {
    setSendingTest(kind);
    const res = await fetch(kind === "email" ? "/api/test-email" : "/api/test-sms", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSendingTest(null);
    if (res.ok) toast(kind === "email" ? `Test email sent to ${email}. Check your inbox (and spam).` : `Test text sent to ${body.to ?? "your phone"}.`, "success");
    else toast(body.error ?? `Couldn't send the test ${kind === "email" ? "email" : "text"}.`, "error");
  }

  async function teamCall(path: string, payload: Record<string, unknown>) {
    setTeamBusy(true);
    setTeamError(null);
    let res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    let body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.needsLeave && (await confirm(`${body.error} Continue?`, { confirmLabel: "Leave and continue", danger: true }))) {
      res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, leaveCurrent: true }) });
      body = await res.json().catch(() => ({}));
    }
    setTeamBusy(false);
    if (!res.ok) {
      setTeamError(body.error ?? "Something went wrong.");
      return false;
    }
    setTeamMode("none");
    load();
    refreshSession();
    return true;
  }

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (await teamCall("/api/team/create", { name: newOrgName.trim() })) toast("Team created. Invite people from the Team page.", "success");
  }

  async function handleJoinTeam(e: React.FormEvent) {
    e.preventDefault();
    if (await teamCall("/api/team/join", { code: joinCode.trim() })) toast("You've joined the team", "success");
  }

  async function handleLeaveTeam() {
    const ok = await confirm(
      teamRole === "owner"
        ? "You own this team. If you leave, ownership passes to another admin (or the longest-standing member). Leave anyway?"
        : "Leave this team? Bills you track stay with you; you'll stop seeing your teammates' bills.",
      { confirmLabel: "Leave team", danger: true },
    );
    if (!ok) return;
    setTeamBusy(true);
    const res = await fetch("/api/team/leave", { method: "POST" });
    setTeamBusy(false);
    if (!res.ok) return toast("Couldn't leave the team. Try again.", "error");
    toast("Left the team", "info");
    load();
    refreshSession();
  }

  const roleLabel = teamRole === "owner" ? "the owner" : teamRole === "admin" ? "an admin" : "a member";

  return (
    <div className="page settings">
      <PageHeader title="Settings" description="Your details, how you're alerted, your team, and how the app looks on this device." />

      {loading ? (
        <Spinner label="Loading settings…" />
      ) : error && !email ? (
        <p className="error-text">Couldn't load settings: {error}</p>
      ) : (
        <>
          <form onSubmit={handleSave}>
            {hasTeamFeatures && (
              <section className="set-section">
                <h2 className="set-title">You</h2>
                <Row title="Your name" desc="Shown to your teammates on tasks, notes and bills you follow.">
                  <input className="input" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} aria-label="Your name" placeholder="First and last name" />
                </Row>
                <Row title="Job title" desc="Optional. Helps a larger team see who does what.">
                  <input className="input" autoComplete="organization-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} aria-label="Job title" placeholder="e.g. Policy Director" />
                </Row>
                <Row title="Email" desc="Contact your administrator to change the email on your account.">
                  <strong>{email}</strong>
                </Row>
              </section>
            )}

            <section className="set-section" id="notifications">
              <h2 className="set-title">Notifications</h2>
              <p className="set-intro">Everything also lands in the bell at the top of every page, so nothing is missed if a device is off.</p>

              {hasTeamFeatures && <PushControls />}
              {hasTeamFeatures && (
                <label className="check-row set-sub-check">
                  <input type="checkbox" checked={notifyPush} onChange={(e) => setNotifyPush(e.target.checked)} /> Push alerts when bills I follow move (invitations and tasks always come through)
                </label>
              )}

              <div className="channel">
                <span className="channel-icon" aria-hidden="true"><Mail size={17} /></span>
                <span className="channel-title">
                  Email {status && !status.email ? <span className="channel-state is-warn">Not set up for this app</span> : emailNotificationsEnabled ? <span className="channel-state is-on">On</span> : <span className="channel-state">Off</span>}
                </span>
                <div className="channel-actions">
                  <label className="switch-row">
                    <input type="checkbox" className="switch" checked={emailNotificationsEnabled} onChange={(e) => setEmailNotificationsEnabled(e.target.checked)} aria-label="Email alerts" />
                  </label>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => sendTest("email")} disabled={sendingTest !== null || (status ? !status.email : false)}>{sendingTest === "email" ? "Sending…" : "Send a test"}</button>
                </div>
                <p className="channel-desc">
                  One summary email on mornings when bills you follow change, plus the drug board and client report emails you've chosen. Off until you turn it on.
                  {status && !status.email && " An admin needs to connect the email service (see Data sources) before anything can be sent."}
                </p>
              </div>

              <div className="channel">
                <span className="channel-icon" aria-hidden="true"><MessageSquare size={17} /></span>
                <span className="channel-title">
                  Text messages {status && !status.sms ? <span className="channel-state is-warn">Not set up for this app yet</span> : phone ? <span className="channel-state is-on">To {phone}</span> : <span className="channel-state">No number</span>}
                </span>
                <div className="channel-actions">
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => sendTest("sms")} disabled={sendingTest !== null || !status?.sms || !phone.trim()}>{sendingTest === "sms" ? "Sending…" : "Send a test"}</button>
                </div>
                <p className="channel-desc">
                  A short text when a bill you've turned texts on for moves. Reply STOP to any text to stop them.
                  {status && !status.sms && " Texts need a Twilio account connected by an admin; until then nothing is sent."}
                </p>
                <div className="channel-extra">
                  <input id="phone" type="tel" className="input" autoComplete="tel" placeholder="(410) 555-0123" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Mobile number" />
                </div>
              </div>

              <Row title="For bills you track from now on" desc="You can change alerts for any single bill from its menu.">
                <div className="stack-sm">
                  <label className="check-row"><input type="checkbox" checked={defaultNotifyEmail} onChange={(e) => setDefaultNotifyEmail(e.target.checked)} /> Email me</label>
                  <label className="check-row"><input type="checkbox" checked={defaultNotifySms} onChange={(e) => setDefaultNotifySms(e.target.checked)} /> Text me</label>
                </div>
              </Row>
            </section>

            <div className="set-actions set-actions-sticky">
              {error && <p className="error-text">{error}</p>}
              {saved && <p className="saved-text">Saved</p>}
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>

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
                <Row title={orgName} desc={`You're ${roleLabel} of this team. Invite people, change roles and manage the invite code on the Team page.`}>
                  <Link href="/team" className="btn btn-secondary">Manage team</Link>
                </Row>
                <Row title="Leave this team" desc="Your tracked bills stay with you. You'll stop seeing your teammates' bills.">
                  <button className="btn btn-secondary btn-danger-text" onClick={handleLeaveTeam} disabled={teamBusy}>Leave team</button>
                </Row>
                {teamError && <p className="error-text">{teamError}</p>}
              </>
            ) : (
              <Row title="Work with a team" desc="Teammates share topics, see each other's bills and positions, assign each other tasks, and get a shared task board. Got an invitation email? Use its button instead.">
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

          {!hasTeamFeatures && (
            <section className="set-section">
              <h2 className="set-title">Account</h2>
              <Row title="Email" desc="Contact your administrator to change the email on your account.">
                <strong>{email}</strong>
              </Row>
            </section>
          )}
        </>
      )}
    </div>
  );
}

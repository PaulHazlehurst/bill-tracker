"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import { createClient } from "@/lib/supabase/client";

type Info = { teamName: string; email: string; role: string; inviter: string | null; expiresAt: string };

// Where an invitation email's button lands. Shows what the invitation is
// for, then: sign up, log in, or (already signed in) join with one click.
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const supabase = createClient();
  const [info, setInfo] = useState<Info | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [me, setMe] = useState<{ email: string } | null | undefined>(undefined);
  const [needsLeave, setNeedsLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/team/invite-info?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => (ok ? setInfo(b) : setProblem(b.error ?? "This invitation link doesn't work.")))
      .catch(() => setProblem("Couldn't load the invitation. Check your connection and refresh."));
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.email ? { email: data.user.email } : null));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function join(leaveCurrent = false) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/team/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, leaveCurrent }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) return router.push("/team");
    if (body.needsLeave) return setNeedsLeave(true);
    setError(body.error ?? "Couldn't join the team.");
  }

  async function switchAccount() {
    await supabase.auth.signOut();
    router.push(`/login?next=${encodeURIComponent(`/join/${token}`)}`);
  }

  const role = info?.role === "admin" ? "an admin" : "a member";
  const wrongEmail = !!(me && info && me.email.toLowerCase() !== info.email.toLowerCase());

  return (
    <AuthShell
      title={problem ? "This invitation can't be used" : info ? `Join ${info.teamName}` : "Team invitation"}
      subtitle={problem ?? (info ? `${info.inviter ?? "Someone on the team"} invited ${info.email} to join as ${role}.` : "Loading the invitation…")}
      footer={<Link href="/login">Go to log in</Link>}
    >
      {info && !problem && (
        <div className="auth-form">
          {me === undefined ? null : me === null ? (
            <>
              <Link className="btn btn-primary btn-lg auth-submit" href={`/signup?invite=${encodeURIComponent(token)}`}>Create an account and join</Link>
              <Link className="btn btn-secondary btn-lg auth-submit" href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}>I already have an account</Link>
            </>
          ) : wrongEmail ? (
            <>
              <p className="notice">You're signed in as {me.email}, but this invitation is for {info.email}.</p>
              <button className="btn btn-primary btn-lg auth-submit" onClick={switchAccount}>Sign in as {info.email}</button>
            </>
          ) : needsLeave ? (
            <>
              <p className="notice">You're on another team. Joining {info.teamName} takes you off it. Bills you track stay with you.</p>
              <button className="btn btn-primary btn-lg auth-submit" onClick={() => join(true)} disabled={busy}>{busy ? "Joining…" : `Leave it and join ${info.teamName}`}</button>
              <Link className="btn btn-ghost btn-lg auth-submit" href="/dashboard">Not now</Link>
            </>
          ) : (
            <button className="btn btn-primary btn-lg auth-submit" onClick={() => join(false)} disabled={busy}>{busy ? "Joining…" : `Join ${info.teamName}`}</button>
          )}
          {error && <p className="error-text">{error}</p>}
          <p className="field-hint">This invitation works until {new Date(info.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.</p>
        </div>
      )}
    </AuthShell>
  );
}

"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, BellRing } from "lucide-react";
import { BrandMark } from "@/components/Sidebar";

// One-click unsubscribe from an email link - no login needed.
function Unsubscribe() {
  const uid = useSearchParams().get("uid");
  const [status, setStatus] = useState<"working" | "off" | "on" | "error">("working");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return setStatus("error");
    fetch(`/api/unsubscribe?uid=${encodeURIComponent(uid)}`)
      .then((r) => setStatus(r.ok ? "off" : "error"))
      .catch(() => setStatus("error"));
  }, [uid]);

  async function toggle(resubscribe: boolean) {
    if (!uid) return;
    setBusy(true);
    const res = await fetch(`/api/unsubscribe?uid=${encodeURIComponent(uid)}${resubscribe ? "&resubscribe=true" : ""}`).catch(() => null);
    setBusy(false);
    // Previously this always fell back to "You're unsubscribed", even right
    // after turning emails back on.
    setStatus(res?.ok ? (resubscribe ? "on" : "off") : "error");
  }

  return (
    <div className="solo">
      <Link href="/" className="auth-brand"><BrandMark size={28} /><span>Bill Tracker</span></Link>
      <div className="solo-card">
        {status === "working" && <p className="muted">Updating your email settings…</p>}
        {status === "error" && (
          <>
            <h1 className="solo-title">That link didn't work</h1>
            <p className="muted">It may be incomplete. You can turn email alerts off any time in <Link href="/settings">Settings</Link>.</p>
          </>
        )}
        {status === "off" && (
          <>
            <CheckCircle2 size={30} className="solo-icon" />
            <h1 className="solo-title">You're unsubscribed</h1>
            <p className="muted">You won't get email alerts from Bill Tracker. Your tracked bills and account are unchanged.</p>
            <button className="btn btn-secondary" onClick={() => toggle(true)} disabled={busy}>{busy ? "Turning emails back on…" : "Turn emails back on"}</button>
          </>
        )}
        {status === "on" && (
          <>
            <BellRing size={30} className="solo-icon" />
            <h1 className="solo-title">Email alerts are back on</h1>
            <p className="muted">You'll get a summary when bills you follow change.</p>
            <button className="btn btn-ghost" onClick={() => toggle(false)} disabled={busy}>Unsubscribe again</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <Unsubscribe />
    </Suspense>
  );
}

"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

// Genuinely public - no login required, no sidebar. This is what a real
// one-click unsubscribe means: the link itself IS the action, processed
// automatically the moment the page loads, not gated behind signing in
// first (which is what the old "manage settings" link required, and
// wasn't actually CAN-SPAM compliant).
export default function UnsubscribePage() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid");
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  const [resubscribing, setResubscribing] = useState(false);

  useEffect(() => {
    if (!uid) {
      setStatus("error");
      return;
    }
    fetch(`/api/unsubscribe?uid=${uid}`)
      .then((r) => (r.ok ? setStatus("done") : setStatus("error")))
      .catch(() => setStatus("error"));
  }, [uid]);

  async function handleResubscribe() {
    if (!uid) return;
    setResubscribing(true);
    // This one does need the admin-backed route too, since there's still
    // no session on this page - reuses the same public endpoint pattern,
    // just flipping the value back on via a dedicated action.
    await fetch(`/api/unsubscribe?uid=${uid}&resubscribe=true`);
    setResubscribing(false);
    setStatus("working");
    setTimeout(() => setStatus("done"), 300);
  }

  return (
    <div>
      <nav className="nav">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>Bill Tracker</Link>
      </nav>

      <div className="container" style={{ maxWidth: 480, paddingTop: 80, textAlign: "center" }}>
        {status === "working" && <p className="muted">Working…</p>}

        {status === "error" && (
          <p className="error-text">That unsubscribe link looks invalid or has already expired.</p>
        )}

        {status === "done" && (
          <>
            <CheckCircle2 size={32} style={{ color: "var(--pos-support)", marginBottom: 12 }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 500, marginBottom: 8 }}>You're unsubscribed</h1>
            <p className="muted" style={{ marginBottom: 20 }}>
              You won't get any more email alerts from Bill Tracker. Your tracked bills and account are unchanged.
            </p>
            <button className="ghost" onClick={handleResubscribe} disabled={resubscribing}>
              {resubscribing ? "Undoing…" : "That was a mistake - turn emails back on"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

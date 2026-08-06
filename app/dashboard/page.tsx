"use client";

// These pages depend on the signed-in user's session, which only exists at
// request time in the browser - there's no sensible static/build-time version
// of them. This tells Next.js to render on each request instead of trying to
// pre-build static HTML (which would run before any Supabase session exists).
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BillCard, { TrackedBillRow } from "@/components/BillCard";
import NavBar from "@/components/NavBar";
import BillSearch from "@/components/BillSearch";
import Spinner from "@/components/Spinner";

export default function DashboardPage() {
  const supabase = createClient();
  const router = useRouter();
  const [tracked, setTracked] = useState<TrackedBillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadTracked() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data, error: queryError } = await supabase
      .from("tracked_bills")
      .select("bill_id, notify_email, notify_sms, bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (queryError) {
      console.error("failed to load tracked bills", queryError);
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setError(null);
    setTracked((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadTracked();
  }, []);

  return (
    <div>
      <NavBar />
      <div className="container">
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Your tracked bills</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Search for a bill below to start tracking it and choose how you want to hear about updates.
        </p>

        <BillSearch onTracked={loadTracked} />

        <div style={{ marginTop: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 16, fontWeight: 500 }}>Currently tracking ({tracked.length})</h2>
            <a href="/api/export?scope=personal"><button className="ghost">Export CSV</button></a>
          </div>
          {error ? (
            <p className="error-text">Couldn't load your tracked bills: {error}</p>
          ) : loading ? (
            <Spinner label="Loading your tracked bills…" />
          ) : tracked.length === 0 ? (
            <p className="muted">Nothing tracked yet — search for a bill above to add one.</p>
          ) : (
            tracked.map((row) => <BillCard key={row.bill_id} row={row} />)
          )}
        </div>
      </div>
    </div>
  );
}

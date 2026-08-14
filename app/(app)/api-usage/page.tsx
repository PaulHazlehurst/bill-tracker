"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import { useTicker } from "@/lib/useTicker";
import { timeAgo } from "@/lib/billMeta";
import { Gauge } from "lucide-react";

type Snapshot = { service: string; limit_value: number | null; remaining_value: number | null; updated_at: string };

const SERVICES = [
  {
    key: "congress_gov",
    name: "congress.gov",
    staticLimit: 5000,
    staticLimitLabel: "5,000 requests / hour (official)",
  },
  {
    key: "lda_gov",
    name: "LDA.gov (lobbying data)",
    staticLimit: null,
    staticLimitLabel: null, // filled in dynamically below based on whether a key is configured
  },
];

export default function ApiUsagePage() {
  const supabase = createClient();
  const router = useRouter();
  useTicker(60_000);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callsLastHour, setCallsLastHour] = useState<Record<string, number>>({});
  const [callsLast24h, setCallsLast24h] = useState<Record<string, number>>({});
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [ldaKeyConfigured, setLdaKeyConfigured] = useState(false);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const res = await fetch("/api/admin/api-usage");
    if (!res.ok) {
      setError("Couldn't load API usage data.");
      setLoading(false);
      return;
    }
    const body = await res.json();
    setCallsLastHour(body.callsLastHour ?? {});
    setCallsLast24h(body.callsLast24h ?? {});
    setSnapshots(body.officialSnapshots ?? []);
    setLdaKeyConfigured(!!body.ldaKeyConfigured);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Auto-refresh every 30s so this is actually useful to leave open
    // while you're working, per the original request.
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>API Usage</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Live view of outbound calls this app has made. Refreshes automatically every 30 seconds.
          </p>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading usage…" />
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          {SERVICES.map((svc) => {
            const snapshot = snapshots.find((s) => s.service === svc.key);
            const hourCount = callsLastHour[svc.key] ?? 0;
            const dayCount = callsLast24h[svc.key] ?? 0;

            const officialLimit = snapshot?.limit_value ?? null;
            const officialRemaining = snapshot?.remaining_value ?? null;
            const hasOfficial = officialLimit !== null && officialRemaining !== null;
            const usedFraction = hasOfficial ? 1 - officialRemaining! / officialLimit! : null;

            const staticLabel = svc.key === "lda_gov"
              ? (ldaKeyConfigured ? "~120 requests / minute (with key)" : "~15 requests / minute (anonymous - no LDA_API_KEY set)")
              : svc.staticLimitLabel;

            return (
              <div key={svc.key} className="card usage-card">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Gauge size={16} className="muted" />
                  <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, margin: 0 }}>{svc.name}</h2>
                </div>

                {hasOfficial ? (
                  <>
                    <div className="usage-official-numbers">
                      <span><strong>{officialRemaining!.toLocaleString()}</strong> remaining</span>
                      <span className="muted">of {officialLimit!.toLocaleString()}</span>
                    </div>
                    <div className="usage-bar">
                      <div
                        className={`usage-bar-fill ${usedFraction! > 0.8 ? "usage-bar-danger" : usedFraction! > 0.5 ? "usage-bar-warn" : ""}`}
                        style={{ width: `${Math.min(usedFraction! * 100, 100)}%` }}
                      />
                    </div>
                    <p className="muted" style={{ fontSize: '0.6875rem', marginTop: 6 }}>
                      As reported by {svc.name}, {timeAgo(snapshot!.updated_at)}
                    </p>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: '0.8125rem' }}>
                    No official count yet - {svc.name} hasn't been called since this page's tracking was added, or doesn't report a rate-limit header.
                  </p>
                )}

                <div className="usage-self-tracked">
                  <div>
                    <div className="usage-self-value">{hourCount}</div>
                    <div className="usage-self-label">calls, last hour</div>
                  </div>
                  <div>
                    <div className="usage-self-value">{dayCount}</div>
                    <div className="usage-self-label">calls, last 24h</div>
                  </div>
                </div>

                {staticLabel && (
                  <p className="muted" style={{ fontSize: '0.6875rem', marginTop: 10 }}>Known limit: {staticLabel}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

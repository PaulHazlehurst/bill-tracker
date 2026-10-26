"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/ui/PageHeader";
import { useTicker } from "@/lib/useTicker";
import { timeAgo } from "@/lib/billMeta";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, RefreshCw } from "lucide-react";

type Snapshot = { service: string; limit_value: number | null; remaining_value: number | null; updated_at: string };
type Check = { id: string; group: string; name: string; status: "ok" | "warn" | "fail" | "skip"; detail: string; ms?: number; fix?: string };

const SERVICES = [
  { key: "congress_gov", name: "congress.gov", limit: "5,000 requests an hour" },
  { key: "govinfo_gov", name: "GovInfo", limit: "Shares the congress.gov hourly allowance (same api.data.gov key)" },
  { key: "lda_gov", name: "LDA.gov lobbying data", limit: null },
  { key: "federal_register", name: "Federal Register", limit: "No published limit" },
  { key: "news_feed", name: "Google News feed", limit: "Public feed, no published limit" },
  { key: "rss_feed", name: "Newsroom RSS feeds", limit: "Public feeds, cached for an hour" },
];

const ICON = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle, skip: MinusCircle };
const GROUP_ORDER = ["Database updates", "Data sources", "Scheduled jobs", "Database", "Alerts", "Settings"];

type Run = { id: number; job: string; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; summary: Record<string, any> | null };

const JOB_NAMES: Record<string, string> = { poll: "Morning check", notify: "Alerts and reports" };

// One short line per run, from whatever the job reported.
function runLine(r: Run) {
  if (!r.finished_at) return "Didn't finish";
  if (r.ok === false) return r.error ?? "Failed";
  const s = r.summary ?? {};
  if (r.job === "poll") return `${s.polled ?? 0} bills checked, ${s.changed ?? 0} changed${s.failed ? `, ${s.failed} failed` : ""}${s.timedOut ? ", ran out of time" : ""}`;
  return `${s.emailsSent ?? 0} alert email${s.emailsSent === 1 ? "" : "s"}${s.smsSent ? `, ${s.smsSent} texts` : ""}${s.clientReports?.sent ? `, ${s.clientReports.sent} client reports` : ""}`;
}

export default function DataSourcesPage() {
  const supabase = createClient();
  const router = useRouter();
  useTicker(60_000);

  const [usage, setUsage] = useState<{ hour: Record<string, number>; day: Record<string, number>; snaps: Snapshot[]; lda: boolean } | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ checkedAt: string; summary: { ok: number; warn: number; fail: number }; results: Check[]; runs?: Run[] } | null>(null);
  const [checking, setChecking] = useState(false);

  async function loadUsage() {
    const res = await fetch("/api/admin/api-usage").catch(() => null);
    if (!res || !res.ok) return setUsageError("Couldn't load usage numbers.");
    const b = await res.json();
    setUsage({ hour: b.callsLastHour ?? {}, day: b.callsLast24h ?? {}, snaps: b.officialSnapshots ?? [], lda: !!b.ldaKeyConfigured });
  }

  async function runHealth() {
    setChecking(true);
    const res = await fetch("/api/admin/health").catch(() => null);
    if (res && res.ok) setHealth(await res.json());
    setChecking(false);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push("/login");
    });
    loadUsage();
    runHealth();
    const id = setInterval(loadUsage, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = GROUP_ORDER.map((g) => ({ g, items: (health?.results ?? []).filter((r) => r.group === g) })).filter((x) => x.items.length);

  return (
    <div className="page">
      <PageHeader
        title="Data sources"
        description="Everything this app connects to, whether it's working right now, and how much of each service's allowance we're using."
        actions={<button className="btn btn-secondary" onClick={runHealth} disabled={checking}><RefreshCw size={15} className={checking ? "spin" : ""} /> {checking ? "Testing…" : "Test all connections"}</button>}
      />

      <section className="health">
        {!health ? (
          <div className="skel skel-block" />
        ) : (
          <>
            <div className={`health-summary ${health.summary.fail ? "is-fail" : health.summary.warn ? "is-warn" : "is-ok"}`}>
              <strong>
                {health.summary.fail
                  ? `${health.summary.fail} connection${health.summary.fail === 1 ? " needs" : "s need"} attention`
                  : health.summary.warn
                    ? `Everything essential works. ${health.summary.warn} thing${health.summary.warn === 1 ? "" : "s"} worth a look.`
                    : "Everything is connected and working."}
              </strong>
              <span>Tested {timeAgo(health.checkedAt)}</span>
            </div>
            {groups.map(({ g, items }) => (
              <div key={g} className="health-group">
                <h2 className="health-group-title">{g}</h2>
                <ul>
                  {items.map((c) => {
                    const Icon = ICON[c.status];
                    return (
                      <li key={c.id} className={`health-item st-${c.status}`}>
                        <Icon size={17} className="health-icon" aria-label={c.status} />
                        <div className="health-text">
                          <span className="health-name">{c.name}</span>
                          <span className="health-detail">{c.detail}</span>
                          {c.fix && c.status !== "ok" && <span className="health-fix">{c.fix}</span>}
                        </div>
                        {typeof c.ms === "number" && <span className="health-ms">{c.ms < 1000 ? `${c.ms} ms` : `${(c.ms / 1000).toFixed(1)} s`}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>

      {health?.runs && health.runs.length > 0 && (
        <section className="runs">
          <h2 className="section-title" style={{ marginTop: 36 }}>Recent scheduled runs</h2>
          <p className="card-sub">The two daily jobs, newest first. Each one checks that the other ran, and emails if something went wrong.</p>
          <ul className="runs-list">
            {health.runs.map((r) => (
              <li key={r.id} className={`runs-item ${r.ok === false || !r.finished_at ? "is-bad" : "is-ok"}`}>
                <span className="runs-job">{JOB_NAMES[r.job] ?? r.job}</span>
                <span className="runs-when">{new Date(r.started_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                <span className="runs-what">{runLine(r)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="section-title" style={{ marginTop: 36 }}>Usage</h2>
      <p className="card-sub">Calls this app made to each service. Updates every 30 seconds.</p>
      {usageError && <p className="error-text">{usageError}</p>}
      <div className="usage-grid">
        {SERVICES.map((svc) => {
          const snap = usage?.snaps.find((s) => s.service === svc.key);
          const hasOfficial = snap && snap.limit_value != null && snap.remaining_value != null;
          const used = hasOfficial ? 1 - snap!.remaining_value! / snap!.limit_value! : null;
          const limit = svc.key === "lda_gov" ? (usage?.lda ? "120 requests a minute (with key)" : "15 requests a minute without a key") : svc.limit;
          return (
            <div key={svc.key} className="card usage">
              <h3 className="usage-name">{svc.name}</h3>
              <div className="usage-nums">
                <div><span className="usage-n">{usage ? (usage.hour[svc.key] ?? 0).toLocaleString() : "–"}</span><span className="usage-l">last hour</span></div>
                <div><span className="usage-n">{usage ? (usage.day[svc.key] ?? 0).toLocaleString() : "–"}</span><span className="usage-l">last 24 hours</span></div>
              </div>
              {hasOfficial && (
                <>
                  <div className="meter"><span className={used! > 0.8 ? "is-hot" : used! > 0.5 ? "is-warm" : ""} style={{ width: `${Math.min(100, used! * 100)}%` }} /></div>
                  <p className="usage-foot">{snap!.remaining_value!.toLocaleString()} of {snap!.limit_value!.toLocaleString()} left this hour, as reported {timeAgo(snap!.updated_at)}</p>
                </>
              )}
              {limit && <p className="usage-foot">{limit}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

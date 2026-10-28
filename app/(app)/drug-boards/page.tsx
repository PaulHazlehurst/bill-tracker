"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { useUI } from "@/components/UIProvider";
import { formatDate, timeAgo } from "@/lib/billMeta";
import {
  DRUG_STAGES, DRUG_STAGE_LABELS, DRUG_TRACK, drugStageTone, drugTrackPosition, STATE_TILES, STATE_NAMES, DOC_KIND_LABELS, isAboutDrugBoards, type DrugStage,
} from "@/lib/drugBoards";
import { matchMedicarePrice, formatUsd, checkAge, type MedicarePrice } from "@/lib/boardReading";
import type { Op } from "@/lib/textDiff";
import { Pill, RefreshCw, Plus, Check, ExternalLink, X, Pencil, Bell, BellOff, AlertTriangle, EyeOff, FileText, CalendarPlus, ShieldCheck, Gavel, ChevronDown } from "lucide-react";

type Board = { state: string; name: string; agency: string | null; status: string; authority: string | null; summary: string | null; summary_source: string | null; website: string | null; email_signup: string | null; updated_at: string; confirmed_at?: string | null };
type Page = { id: string; state: string; url: string; label: string | null; last_checked_at: string | null; last_changed_at: string | null; last_error: string | null };
type Drug = { id: string; state: string; drug: string; manufacturer: string | null; stage: DrugStage; price_limit: string | null; limit_basis: string | null; next_step: string | null; next_date: string | null; source_url: string | null; notes: string | null; needs_check: boolean; updated_at: string; confirmed_at?: string | null };
type Doc = {
  id: string; state: string; url: string; title: string | null; kind: string | null; doc_date: string | null; first_seen_at: string; reviewed_at?: string | null;
  text_status?: "read" | "unreadable" | "skipped" | null; text_note?: string | null; mentions?: string[]; mention_snippets?: { term: string; snippet: string }[];
};
type DateItem = { id: string; state: string; date: string; time: string | null; kind: string; title: string; url: string | null; source?: "team" | "document"; document_id?: string | null };
type PageChange = { id: string; page_id: string; state: string; detected_at: string; ops: Op[] | null; added: number; removed: number };
type Case = {
  id: string; state: string; board_drug_id: string | null; name: string; court: string; court_code: string | null; docket_number: string | null; courtlistener_id: number | null;
  url: string | null; notes: string | null; last_filing_date: string | null; last_checked_at: string | null; last_error: string | null;
};
type Filing = { id: string; case_id: string; date_filed: string | null; description: string; url: string | null; baseline: boolean; reviewed_at: string | null; first_seen_at: string };
type StateBill = { id: string; state: string; session: string | null; identifier: string; title: string; latest_action: string | null; latest_action_date: string | null; url: string | null; first_seen_at: string };
type Data = {
  ready: boolean; error?: string; today: string; boards: Board[]; pages: Page[]; drugs: Drug[]; newDocuments: Doc[]; recentDocuments: Doc[];
  dates: DateItem[]; datedAgendas: Doc[]; bills: StateBill[]; hiddenBills: number; lastChecked: string | null; alerts: { on: boolean; emailOn: boolean }; openStatesConfigured: boolean;
  accuracy: boolean; pageChanges: PageChange[]; cases: Case[]; filings: Filing[]; medicarePrices: MedicarePrice[]; courtListenerConfigured: boolean;
};

const KIND_LABEL: Record<string, string> = { meeting: "Meeting", comment_deadline: "Comments due", hearing: "Hearing", other: "Date" };

function boardTone(b: Board | undefined) {
  if (!b) return "none";
  if (b.status === "dissolved") return "gone";
  if ((b.authority ?? "").toLowerCase().includes("price limit")) return "caps";
  return "reviews";
}

export default function DrugBoardsPage() {
  const { toast, confirm } = useUI();
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState<Drug | "new" | null>(null);
  const [editingBoard, setEditingBoard] = useState<Board | null>(null);
  const [addingDate, setAddingDate] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [onlyToCheck, setOnlyToCheck] = useState(false);
  const [openChange, setOpenChange] = useState<string | null>(null);
  const [editingCase, setEditingCase] = useState<Case | "new" | null>(null);

  async function load() {
    const res = await fetch("/api/drug-boards").catch(() => null);
    if (!res || !res.ok) return toast("Couldn't load the boards. Try again in a moment.", "error");
    setData(await res.json());
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkNow() {
    setChecking(true);
    const res = await fetch("/api/drug-boards/check", { method: "POST" }).catch(() => null);
    setChecking(false);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) return toast(body.error ?? "The check didn't finish.", "error");
    const found = [
      [body.pages?.newDocuments ?? 0, "new document"],
      [body.pages?.wordingChanges ?? 0, "page wording change"],
      [body.reading?.courts?.newFilings ?? 0, "court filing"],
      [body.bills?.added ?? 0, "new state bill"],
    ].filter(([n]) => (n as number) > 0).map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`);
    toast(found.length ? `Found ${found.join(", ")}` : "Checked every board. Nothing new.", found.length ? "success" : "info");
    load();
  }

  async function markRead(ids: string[], type: "document" | "change" | "filing" = "document") {
    if (!ids.length) return;
    setData((d) =>
      d && {
        ...d,
        newDocuments: type === "document" ? d.newDocuments.filter((x) => !ids.includes(x.id)) : d.newDocuments,
        pageChanges: type === "change" ? d.pageChanges.filter((x) => !ids.includes(x.id)) : d.pageChanges,
        filings: type === "filing" ? d.filings.map((x) => (ids.includes(x.id) ? { ...x, reviewed_at: new Date().toISOString() } : x)) : d.filings,
      },
    );
    const res = await fetch("/api/drug-boards/documents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, reviewed: true, type }) });
    if (!res.ok) {
      toast("Couldn't mark that as read.", "error");
      load();
    }
  }

  async function confirmEntry(kind: "drug" | "board", id: string, label: string) {
    const res = await fetch("/api/drug-boards/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast(body.error ?? "Couldn't save that.", "error");
    toast(`Marked ${label} as checked today`, "success");
    setData((d) =>
      d && {
        ...d,
        drugs: kind === "drug" ? d.drugs.map((x) => (x.id === id ? { ...x, confirmed_at: body.confirmed_at, needs_check: false } : x)) : d.drugs,
        boards: kind === "board" ? d.boards.map((x) => (x.state === id ? { ...x, confirmed_at: body.confirmed_at } : x)) : d.boards,
      },
    );
  }

  async function setAlerts(on: boolean) {
    const res = await fetch("/api/drug-boards/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: on }) });
    if (!res.ok) return toast("Couldn't change that.", "error");
    setData((d) => d && { ...d, alerts: { ...d.alerts, on } });
    toast(on ? (data?.alerts.emailOn ? "You'll get an email when boards post something new" : "Saved. Turn on email in Settings to receive it") : "Drug board emails are off", on && !data?.alerts.emailOn ? "info" : "success");
  }

  async function hideBill(b: StateBill) {
    setData((d) => d && { ...d, bills: d.bills.filter((x) => x.id !== b.id), hiddenBills: d.hiddenBills + 1 });
    const res = await fetch("/api/drug-boards/bills", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.id, hidden: true }) });
    if (!res.ok) {
      toast("Couldn't hide that bill.", "error");
      load();
    }
  }

  async function deleteDate(d: DateItem) {
    if (!(await confirm(`Remove "${d.title}" on ${formatDate(d.date)}?`, { confirmLabel: "Remove", danger: true }))) return;
    const res = await fetch(`/api/drug-boards/dates?id=${d.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Couldn't remove it.", "error");
    load();
  }

  const boardsByState = useMemo(() => new Map((data?.boards ?? []).map((b) => [b.state, b])), [data]);
  const billStates = useMemo(() => new Set((data?.bills ?? []).filter((b) => isAboutDrugBoards(b.title)).map((b) => b.state)), [data]);
  const newByState = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data?.newDocuments ?? []) m.set(d.state, (m.get(d.state) ?? 0) + 1);
    return m;
  }, [data]);

  if (data && !data.ready) {
    return (
      <div className="page">
        <PageHeader title="Drug affordability boards" />
        <div className="empty">
          <div className="empty-icon"><Pill size={20} /></div>
          <p className="empty-title">This page needs a one-time database update</p>
          <p className="empty-body">{data.error}</p>
          <div className="empty-action"><Link className="btn btn-secondary" href="/api-usage">Open Data sources</Link></div>
        </div>
      </div>
    );
  }

  const active = (data?.boards ?? []).filter((b) => b.status !== "dissolved");
  const caps = active.filter((b) => boardTone(b) === "caps").length;
  const inState = <T extends { state: string }>(rows: T[]) => (state ? rows.filter((r) => r.state === state) : rows);
  const drugs = inState(data?.drugs ?? []);
  const newDocs = inState(data?.newDocuments ?? []);
  const bills = inState(data?.bills ?? []).sort((a, b) => Number(isAboutDrugBoards(b.title)) - Number(isAboutDrugBoards(a.title)) || String(b.latest_action_date ?? "").localeCompare(String(a.latest_action_date ?? "")));
  const upcoming = [
    ...inState(data?.dates ?? []).map((d) => ({ ...d, source: d.source === "document" ? ("document" as const) : ("team" as const) })),
    ...inState(data?.datedAgendas ?? [])
      .filter((a) => !(data?.dates ?? []).some((d) => d.state === a.state && d.date === a.doc_date))
      .map((a) => ({ id: a.id, state: a.state, date: a.doc_date!, time: null, kind: "meeting", title: a.title ?? "Board meeting", url: a.url, source: "website" as const })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const visibleBoards = state ? active.filter((b) => b.state === state) : active;
  const brokenPages = (data?.pages ?? []).filter((p) => p.last_error);

  // Closer reading (migration 0006): wording changes, court filings, Medicare prices, last-checked dates.
  const accuracy = !!data?.accuracy;
  const prices = data?.medicarePrices ?? [];
  const thisYear = Number((data?.today ?? "").slice(0, 4)) || new Date().getFullYear();
  const pageById = new Map((data?.pages ?? []).map((p) => [p.id, p]));
  const changes = inState(data?.pageChanges ?? []);
  const cases = inState(data?.cases ?? []);
  const caseById = new Map((data?.cases ?? []).map((c) => [c.id, c]));
  const drugById = new Map((data?.drugs ?? []).map((d) => [d.id, d]));
  const newFilings = (data?.filings ?? []).filter((f) => !f.baseline && !f.reviewed_at && (!state || caseById.get(f.case_id)?.state === state));
  const datesFromDoc = (id: string) => (data?.dates ?? []).filter((d) => d.document_id === id).length;
  const dueForCheck = (d: Drug) => d.needs_check || (accuracy && checkAge(d.confirmed_at ?? null).stale);
  const toCheck = drugs.filter(dueForCheck);
  const shownDrugs = onlyToCheck ? toCheck : drugs;
  const feedCount = newDocs.length + changes.length + newFilings.length;

  return (
    <div className="page page-wide db-page">
      <PageHeader
        title="Drug affordability boards"
        description={
          data
            ? `${active.length} states have a board or council reviewing what prescription drugs cost, and ${caps} of them can cap what's paid. This page checks their websites every morning and keeps track of the drugs they're reviewing.`
            : "State boards that review prescription drug costs, the drugs they're reviewing, and bills about them."
        }
        actions={
          <>
            {data && (
              <button className="btn btn-secondary" onClick={() => setAlerts(!data.alerts.on)} aria-pressed={data.alerts.on}>
                {data.alerts.on ? <BellOff size={15} /> : <Bell size={15} />} {data.alerts.on ? "Stop emails" : "Email me updates"}
              </button>
            )}
            <button className="btn btn-primary" onClick={checkNow} disabled={checking || !data}>
              <RefreshCw size={15} className={checking ? "spin" : ""} /> {checking ? "Checking boards…" : "Check boards now"}
            </button>
          </>
        }
      />

      {data && data.ready && !data.accuracy && (
        <p className="db-notice">
          <AlertTriangle size={14} aria-hidden="true" /> One more database update turns on document reading, wording changes, court cases, Medicare prices and last-checked dates: run supabase/migrations/0006_drug_board_accuracy.sql in Supabase.
        </p>
      )}

      {!data ? (
        <div className="db-top"><div className="skel skel-block" style={{ height: 320 }} /><div className="skel skel-block" style={{ height: 320 }} /></div>
      ) : (
        <>
          <div className="db-top">
            <section className="card db-map-card" aria-labelledby="map-title">
              <div className="db-map-head">
                <h2 id="map-title" className="card-title">Where they are</h2>
                {state && <button className="link-btn" onClick={() => setState(null)}>Show all states</button>}
              </div>
              <div className="db-map" role="group" aria-label="States. Choose one to filter the page.">
                {STATE_TILES.map(([abbr, x, y]) => {
                  const b = boardsByState.get(abbr);
                  const tone = boardTone(b);
                  const hasBills = billStates.has(abbr);
                  const fresh = newByState.get(abbr) ?? 0;
                  const label = `${STATE_NAMES[abbr]}: ${b ? `${b.authority ?? b.status}` : "no board"}${hasBills ? ", bills about a board" : ""}${fresh ? `, ${fresh} new documents` : ""}`;
                  return (
                    <button
                      key={abbr}
                      className={`db-tile tone-${tone}${hasBills && tone === "none" ? " has-bills" : ""}${state === abbr ? " is-on" : ""}`}
                      style={{ gridColumn: x + 1, gridRow: y + 1 }}
                      onClick={() => setState(state === abbr ? null : abbr)}
                      aria-pressed={state === abbr}
                      aria-label={label}
                      title={label}
                      disabled={tone === "none" && !hasBills}
                    >
                      {abbr}
                      {fresh > 0 && <span className="db-tile-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              <ul className="db-legend">
                <li><span className="db-key tone-caps" aria-hidden="true" /> Can cap prices</li>
                <li><span className="db-key tone-reviews" aria-hidden="true" /> Reviews and recommends</li>
                <li><span className="db-key tone-gone" aria-hidden="true" /> Dissolved</li>
                <li><span className="db-key has-bills" aria-hidden="true" /> Bills, no board yet</li>
                <li><span className="db-key-dot" aria-hidden="true" /> New on its website</li>
              </ul>
            </section>

            <section className="card db-new" aria-labelledby="new-title">
              <div className="db-section-head">
                <div>
                  <h2 id="new-title" className="card-title">New from the boards</h2>
                  <p className="card-sub">{data.lastChecked ? `Checked ${timeAgo(data.lastChecked)}.` : "Not checked yet. The first check runs tomorrow morning, or now with Check boards now."} Open each one, then update the drug tracker if anything moved.</p>
                </div>
                {feedCount > 1 && (
                  <button
                    className="link-btn"
                    onClick={() => {
                      markRead(newDocs.map((d) => d.id));
                      markRead(changes.map((c) => c.id), "change");
                      markRead(newFilings.map((f) => f.id), "filing");
                    }}
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {feedCount === 0 ? (
                <p className="db-empty">Nothing new{state ? ` from ${STATE_NAMES[state]}` : ""} since you last looked.</p>
              ) : (
                <>
                  {newDocs.length > 0 && (
                    <>
                      {(changes.length > 0 || newFilings.length > 0) && <h3 className="db-feed-h">Documents</h3>}
                      <ul className="db-docs">
                        {newDocs.slice(0, 12).map((d) => {
                          const added = datesFromDoc(d.id);
                          return (
                            <li key={d.id}>
                              <span className="db-state">{d.state}</span>
                              <div className="db-doc-main">
                                <a href={d.url} target="_blank" rel="noreferrer" className="db-doc-title">{d.title || d.url}</a>
                                <span className="db-doc-meta">{DOC_KIND_LABELS[d.kind ?? "other"]}{d.doc_date ? `, ${formatDate(d.doc_date)}` : ""}. Found {timeAgo(d.first_seen_at)}.</span>
                                {(d.mention_snippets ?? []).slice(0, 3).map((m) => (
                                  <span key={m.term} className="db-mention-row">
                                    <span className="db-mention">{m.term}</span>
                                    <q className="db-snippet">{m.snippet}</q>
                                  </span>
                                ))}
                                {added > 0 && <span className="db-doc-note is-good"><CalendarPlus size={12} aria-hidden="true" /> Added {added} date{added === 1 ? "" : "s"} to Coming up</span>}
                                {d.text_status === "unreadable" && <span className="db-doc-note">Couldn&apos;t open it: {d.text_note}. Open it yourself to check.</span>}
                                {d.text_status === "read" && !(d.mentions ?? []).length && !added && <span className="db-doc-note">Doesn&apos;t name a drug on your tracker.</span>}
                              </div>
                              <button className="icon-btn db-read" onClick={() => markRead([d.id])} aria-label={`Mark ${d.title ?? "document"} as read`} title="Mark as read"><Check size={15} /></button>
                            </li>
                          );
                        })}
                        {newDocs.length > 12 && <li className="db-more">and {newDocs.length - 12} more</li>}
                      </ul>
                    </>
                  )}
                  {changes.length > 0 && (
                    <>
                      <h3 className="db-feed-h">Wording changed on a board page</h3>
                      <ul className="db-docs">
                        {changes.slice(0, 8).map((c) => {
                          const pg = pageById.get(c.page_id);
                          const open = openChange === c.id;
                          return (
                            <li key={c.id}>
                              <span className="db-state">{c.state}</span>
                              <div className="db-doc-main">
                                {pg ? <a href={pg.url} target="_blank" rel="noreferrer" className="db-doc-title">{pg.label || pg.url}</a> : <span className="db-doc-title">Board page</span>}
                                <span className="db-doc-meta">
                                  {c.ops ? `${c.added} word${c.added === 1 ? "" : "s"} added, ${c.removed} removed` : "The page was rebuilt, so there's no word-by-word comparison. Open it to see what's there now"}. Noticed {timeAgo(c.detected_at)}.
                                </span>
                                {c.ops && (
                                  <button className="link-btn db-redline-toggle" aria-expanded={open} onClick={() => setOpenChange(open ? null : c.id)}>
                                    <ChevronDown size={14} aria-hidden="true" className={open ? "is-open" : ""} /> {open ? "Hide" : "Show"} what changed
                                  </button>
                                )}
                                {open && c.ops && <Redline ops={c.ops} />}
                              </div>
                              <button className="icon-btn db-read" onClick={() => markRead([c.id], "change")} aria-label={`Mark the change to ${pg?.label ?? "this page"} as read`} title="Mark as read"><Check size={15} /></button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                  {newFilings.length > 0 && (
                    <>
                      <h3 className="db-feed-h">New court filings</h3>
                      <ul className="db-docs">
                        {newFilings.slice(0, 8).map((f) => {
                          const c = caseById.get(f.case_id);
                          return (
                            <li key={f.id}>
                              <span className="db-state">{c?.state}</span>
                              <div className="db-doc-main">
                                {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="db-doc-title">{f.description}</a> : <span className="db-doc-title">{f.description}</span>}
                                <span className="db-doc-meta">{c?.name}{f.date_filed ? `, filed ${formatDate(f.date_filed)}` : ""}.</span>
                              </div>
                              <button className="icon-btn db-read" onClick={() => markRead([f.id], "filing")} aria-label={`Mark the filing in ${c?.name ?? "this case"} as read`} title="Mark as read"><Check size={15} /></button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </>
              )}
              {brokenPages.length > 0 && (
                <p className="db-warn"><AlertTriangle size={14} aria-hidden="true" /> {brokenPages.length} watched page{brokenPages.length === 1 ? "" : "s"} couldn&apos;t be read last time. <button className="link-btn" onClick={() => setShowPages(true)}>See which</button></p>
              )}
            </section>
          </div>

          <section className="card db-tracker" aria-labelledby="tracker-title">
            <div className="db-section-head">
              <div>
                <h2 id="tracker-title" className="card-title">Drugs under review{state ? ` in ${STATE_NAMES[state]}` : ""}</h2>
                <p className="card-sub">
                  Kept current by your team. Every change is recorded with who made it.
                  {accuracy && toCheck.length > 0 && (
                    <>
                      {" "}
                      <button className="link-btn" onClick={() => setOnlyToCheck(!onlyToCheck)} aria-pressed={onlyToCheck}>
                        {onlyToCheck ? "Show every drug" : `${toCheck.length} due for a check`}
                      </button>
                    </>
                  )}
                </p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing("new")}><Plus size={14} /> Add a drug</button>
            </div>
            {shownDrugs.length === 0 ? (
              <p className="db-empty">{onlyToCheck ? "Nothing due for a check." : `No drugs tracked${state ? ` for ${STATE_NAMES[state]}` : ""} yet.`}</p>
            ) : (
              <div className="db-table-wrap">
                <table className="db-table">
                  <thead>
                    <tr><th scope="col">Drug</th><th scope="col">Board</th><th scope="col">Where it stands</th><th scope="col">Price limit</th><th scope="col">Next</th><th scope="col"><span className="sr-only">Edit</span></th></tr>
                  </thead>
                  <tbody>
                    {shownDrugs.map((d) => {
                      const age = checkAge(d.confirmed_at ?? null);
                      const medicare = matchMedicarePrice(d.drug, prices);
                      return (
                      <tr key={d.id}>
                        <td>
                          <span className="db-drug">{d.drug}</span>
                          {d.manufacturer && <span className="db-sub">{d.manufacturer}</span>}
                        </td>
                        <td><span className="db-state">{d.state}</span></td>
                        <td>
                          <span className={`stage-pill tone-${drugStageTone(d.stage)}`}>{DRUG_STAGE_LABELS[d.stage]}</span>
                          <DrugTrack stage={d.stage} />
                          {d.needs_check ? (
                            <span className="db-check" title="Sources disagree. Confirm on the board's site."><AlertTriangle size={12} aria-hidden="true" /> Needs a check</span>
                          ) : accuracy && age.stale ? (
                            <span className="db-check" title="Nobody has confirmed this against its source in the last 30 days."><AlertTriangle size={12} aria-hidden="true" /> {age.days === null ? "Not checked yet" : `Not checked in ${age.days} days`}</span>
                          ) : accuracy ? (
                            <span className="db-checked">{age.label}</span>
                          ) : null}
                        </td>
                        <td>
                          {d.price_limit ? <span className="db-limit">{d.price_limit}</span> : <span className="db-sub">None yet</span>}
                          {d.limit_basis && <span className="db-sub">{d.limit_basis}</span>}
                          {medicare && (
                            <span className="db-medicare">
                              Medicare pays <a href={medicare.source_url} target="_blank" rel="noreferrer">{formatUsd(medicare.price_30_day)}</a> per 30 days
                              {medicare.effective_year > thisYear ? ` from ${medicare.effective_year}` : ` (${medicare.effective_year})`}
                            </span>
                          )}
                        </td>
                        <td>
                          {d.next_date && <span className="db-next-date">{formatDate(d.next_date)}</span>}
                          <span className="db-sub">{d.next_step ?? (d.next_date ? "" : "Nothing scheduled")}</span>
                        </td>
                        <td className="db-row-actions">
                          {d.source_url && <a className="icon-btn" href={d.source_url} target="_blank" rel="noreferrer" aria-label={`Source for ${d.drug}`} title="Source"><ExternalLink size={15} /></a>}
                          {accuracy && <button className="icon-btn" onClick={() => confirmEntry("drug", d.id, d.drug)} aria-label={`${d.drug}: checked against the source, still right`} title="Checked against the source: still right"><ShieldCheck size={15} /></button>}
                          <button className="icon-btn" onClick={() => setEditing(d)} aria-label={`Edit ${d.drug}`} title={`Updated ${timeAgo(d.updated_at)}`}><Pencil size={15} /></button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {accuracy && (
            <section className="card db-cases" aria-labelledby="cases-title">
              <div className="db-section-head">
                <div>
                  <h2 id="cases-title" className="card-title">Court cases</h2>
                  <p className="card-sub">Lawsuits over board decisions. New filings are checked every morning on CourtListener, a free public court records site.</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditingCase("new")}><Gavel size={14} /> Follow a case</button>
              </div>
              {!data.courtListenerConfigured && (
                <p className="db-warn"><AlertTriangle size={14} aria-hidden="true" /> To check filings automatically, add a free CourtListener API token in Vercel as COURTLISTENER_API_TOKEN.</p>
              )}
              {cases.length === 0 ? (
                <p className="db-empty">No cases followed{state ? ` in ${STATE_NAMES[state]}` : ""}.</p>
              ) : (
                <ul className="db-cases-list">
                  {cases.map((c) => {
                    const drug = c.board_drug_id ? drugById.get(c.board_drug_id) : null;
                    const recent = (data.filings ?? []).filter((f) => f.case_id === c.id).slice(0, 3);
                    return (
                      <li key={c.id}>
                        <div className="db-case-top">
                          <span className="db-state">{c.state}</span>
                          <span className="db-case-name">{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}</span>
                          {drug && <span className="db-mention">{drug.drug}</span>}
                          <button className="icon-btn db-case-edit" onClick={() => setEditingCase(c)} aria-label={`Edit ${c.name}`}><Pencil size={14} /></button>
                        </div>
                        <span className="db-sub">
                          {c.court}{c.docket_number ? `, No. ${c.docket_number}` : ""}
                          {c.last_filing_date ? `. Latest filing ${formatDate(c.last_filing_date)}` : ""}
                          {c.courtlistener_id ? <>. <a href={`https://www.courtlistener.com/docket/${c.courtlistener_id}/`} target="_blank" rel="noreferrer">Docket on CourtListener</a></> : ""}
                        </span>
                        {c.last_error ? (
                          <span className="db-case-error"><AlertTriangle size={12} aria-hidden="true" /> {c.last_error}</span>
                        ) : !c.last_checked_at ? (
                          <span className="db-sub">Not checked yet.</span>
                        ) : null}
                        {recent.length > 0 && (
                          <ul className="db-filings">
                            {recent.map((f) => {
                              const isNew = !f.baseline && !f.reviewed_at;
                              return (
                                <li key={f.id} className={isNew ? "is-new" : ""}>
                                  <span className="db-filing-date">{f.date_filed ? formatDate(f.date_filed) : "No date"}</span>
                                  <span>{f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.description}</a> : f.description}{isNew && <span className="db-new-tag">New</span>}</span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {c.notes && <p className="db-case-notes">{c.notes}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <section aria-labelledby="boards-title">
            <h2 id="boards-title" className="section-title db-h2">The boards</h2>
            <ul className="db-boards">
              {visibleBoards.map((b) => {
                const next = upcoming.find((u) => u.state === b.state);
                const count = (data.drugs ?? []).filter((d) => d.state === b.state).length;
                const pages = (data.pages ?? []).filter((p) => p.state === b.state);
                const age = checkAge(b.confirmed_at ?? null);
                return (
                  <li key={b.state} className={`db-board tone-${boardTone(b)}`}>
                    <div className="db-board-top">
                      <span className="db-board-state">{STATE_NAMES[b.state]}</span>
                      <span className={`db-auth tone-${boardTone(b)}`}>{b.authority ?? b.status}</span>
                    </div>
                    <h3 className="db-board-name">{b.name}</h3>
                    {b.summary && <p className="db-board-summary">{b.summary}{b.summary_source && <> <a href={b.summary_source} target="_blank" rel="noreferrer">Source</a></>}</p>}
                    <dl className="db-board-facts">
                      <div><dt>Next date</dt><dd>{next ? `${formatDate(next.date)}: ${next.title}` : "None posted"}</dd></div>
                      <div><dt>Drugs tracked</dt><dd>{count}</dd></div>
                      <div><dt>Pages checked</dt><dd>{pages.length}{pages.some((p) => p.last_error) ? ` (${pages.filter((p) => p.last_error).length} couldn't be read)` : ""}</dd></div>
                      {accuracy && <div><dt>Summary</dt><dd className={age.stale ? "db-stale" : ""}>{age.stale && <AlertTriangle size={12} aria-hidden="true" />} {age.label}</dd></div>}
                    </dl>
                    <div className="db-board-links">
                      {b.website && <a href={b.website} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" /> Website</a>}
                      {b.email_signup && <a href={b.email_signup} target="_blank" rel="noreferrer">Board email list</a>}
                      <button className="link-btn" onClick={() => setEditingBoard(b)}>Correct details</button>
                      {accuracy && <button className="link-btn" onClick={() => confirmEntry("board", b.state, STATE_NAMES[b.state])}>Still right</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="db-bottom">
            <section className="card" aria-labelledby="dates-title">
              <div className="db-section-head">
                <div>
                  <h2 id="dates-title" className="card-title">Coming up</h2>
                  <p className="card-sub">Meetings and comment deadlines. Dates in new board agendas and notices appear here on their own; add anything else.</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setAddingDate(true)}><CalendarPlus size={14} /> Add a date</button>
              </div>
              {upcoming.length === 0 ? (
                <p className="db-empty">Nothing on the calendar{state ? ` for ${STATE_NAMES[state]}` : ""}.</p>
              ) : (
                <ul className="db-dates">
                  {upcoming.slice(0, 12).map((u) => (
                    <li key={`${u.source}-${u.id}`}>
                      <span className="db-date">{formatDate(u.date)}{u.time ? `, ${u.time}` : ""}</span>
                      <span className="db-state">{u.state}</span>
                      <span className="db-date-title">
                        {u.url ? <a href={u.url} target="_blank" rel="noreferrer">{u.title}</a> : u.title}
                        <span className="db-sub">{KIND_LABEL[u.kind] ?? "Date"}{u.source === "website" ? ". From the board's posted agenda" : u.source === "document" ? ". Found in a board document" : ""}</span>
                      </span>
                      {u.source !== "website" && <button className="icon-btn" onClick={() => deleteDate(u as DateItem)} aria-label={`Remove ${u.title}`}><X size={14} /></button>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="db-foot">These also appear on Week ahead and in your calendar link.</p>
            </section>

            <section className="card" aria-labelledby="bills-title">
              <div className="db-section-head">
                <div>
                  <h2 id="bills-title" className="card-title">State bills</h2>
                  <p className="card-sub">Bills in any state that mention drug affordability boards or upper payment limits, from Open States. Ones about the boards themselves come first.</p>
                </div>
              </div>
              {!data.openStatesConfigured ? (
                <p className="db-empty">Add OPEN_STATES_API_KEY in Vercel to turn this on.</p>
              ) : bills.length === 0 ? (
                <p className="db-empty">No bills found{state ? ` in ${STATE_NAMES[state]}` : ""} yet. The search runs every morning.</p>
              ) : (
                <ul className="db-bills">
                  {bills.slice(0, 20).map((b) => (
                    <li key={b.id}>
                      <div className="db-bill-top">
                        <span className="db-state">{b.state}</span>
                        <span className="cite">{b.identifier}</span>
                        {b.session && <span className="db-sub">{b.session}</span>}
                        <button className="icon-btn db-hide" onClick={() => hideBill(b)} aria-label={`Hide ${b.identifier}, not relevant`} title="Not relevant"><EyeOff size={14} /></button>
                      </div>
                      {b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="db-bill-title">{b.title}</a> : <span className="db-bill-title">{b.title}</span>}
                      {b.latest_action && <span className="db-sub">{b.latest_action}{b.latest_action_date ? `, ${formatDate(b.latest_action_date)}` : ""}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {data.hiddenBills > 0 && <p className="db-foot">{data.hiddenBills} marked not relevant.</p>}
            </section>
          </div>

          <section className="db-pages">
            <button className="link-btn" onClick={() => setShowPages(!showPages)} aria-expanded={showPages}>
              <FileText size={14} aria-hidden="true" /> {showPages ? "Hide" : "Show"} the {data.pages.length} board pages checked each morning
            </button>
            {showPages && <PagesList pages={data.pages} boards={active} onChange={load} />}
          </section>

          {accuracy && prices.length > 0 && (
            <section className="db-pages">
              <button className="link-btn" onClick={() => setShowPrices(!showPrices)} aria-expanded={showPrices}>
                <Pill size={14} aria-hidden="true" /> {showPrices ? "Hide" : "Show"} Medicare negotiated prices ({prices.length} drugs)
              </button>
              {showPrices && <MedicarePrices prices={prices} />}
            </section>
          )}
        </>
      )}

      {editing && data && <DrugDialog drug={editing === "new" ? null : editing} boards={active} defaultState={state} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {editingBoard && <BoardDialog board={editingBoard} onClose={() => setEditingBoard(null)} onSaved={() => { setEditingBoard(null); load(); }} />}
      {editingCase && data && <CaseDialog item={editingCase === "new" ? null : editingCase} boards={active} drugs={data.drugs} defaultState={state} onClose={() => setEditingCase(null)} onSaved={() => { setEditingCase(null); load(); }} />}
      {addingDate && data && <DateDialog boards={active} defaultState={state} onClose={() => setAddingDate(false)} onSaved={() => { setAddingDate(false); load(); }} />}
    </div>
  );
}

function Redline({ ops }: { ops: Op[] }) {
  return (
    <p className="official-text rl-ops db-redline">
      {ops
        .map((op, i) =>
          op.t === "gap" ? (
            <span key={i} className="rl-gap">{op.n.toLocaleString()} unchanged words</span>
          ) : op.t === "ins" ? (
            <ins key={i}>{op.s}</ins>
          ) : op.t === "del" ? (
            <del key={i}>{op.s}</del>
          ) : (
            <span key={i}>{op.s}</span>
          ),
        )
        .reduce<React.ReactNode[]>((acc, node, i) => (i ? [...acc, " ", node] : [node]), [])}
    </p>
  );
}

function MedicarePrices({ prices }: { prices: MedicarePrice[] }) {
  const years = Array.from(new Set(prices.map((p) => p.effective_year))).sort();
  return (
    <div className="card db-prices-card">
      <p className="card-sub">
        What Medicare pays for a 30-day supply after negotiating with the manufacturer, next to the list price CMS compared it with. Boards are starting to use these as a reference for their own limits.
      </p>
      {years.map((y) => (
        <div key={y} className="db-prices-year">
          <h3 className="db-feed-h">In effect from January {y}</h3>
          <div className="db-table-wrap">
            <table className="db-table db-prices">
              <thead>
                <tr><th scope="col">Drug</th><th scope="col">Generic name</th><th scope="col" className="num">Medicare price</th><th scope="col" className="num">List price</th><th scope="col" className="num">Lower by</th></tr>
              </thead>
              <tbody>
                {prices.filter((p) => p.effective_year === y).sort((a, b) => a.brand_names[0].localeCompare(b.brand_names[0])).map((p) => {
                  const list = p.list_price_30_day == null ? null : Number(p.list_price_30_day);
                  return (
                    <tr key={p.id}>
                      <td><span className="db-drug">{p.brand_names.join(", ")}</span></td>
                      <td>{p.generic_name}</td>
                      <td className="num"><a href={p.source_url} target="_blank" rel="noreferrer">{formatUsd(p.price_30_day)}</a></td>
                      <td className="num">{list == null ? "" : `${formatUsd(list)} (${p.list_price_year})`}</td>
                      <td className="num">{list ? `${Math.round((1 - Number(p.price_30_day) / list) * 100)}%` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function CaseDialog({ item, boards, drugs, defaultState, onClose, onSaved }: { item: Case | null; boards: Board[]; drugs: Drug[]; defaultState: string | null; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useUI();
  const [f, setF] = useState({
    state: item?.state ?? defaultState ?? boards[0]?.state ?? "",
    name: item?.name ?? "",
    court: item?.court ?? "",
    link: item?.url ?? "",
    court_code: item?.court_code ?? "",
    docket_number: item?.docket_number ?? "",
    board_drug_id: item?.board_drug_id ?? "",
    notes: item?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const stateDrugs = drugs.filter((d) => d.state === f.state);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = { ...f, board_drug_id: f.board_drug_id || null };
    const res = await fetch("/api/drug-boards/cases", { method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item ? { id: item.id, ...payload } : payload) });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return toast(body.error ?? "Couldn't save.", "error");
    toast(item ? "Saved" : "Following it. New filings are checked each morning, or now with Check boards now.", "success");
    onSaved();
  }

  async function remove() {
    if (!item || !(await confirm(`Stop following ${item.name}? Its saved filings go with it.`, { confirmLabel: "Stop following", danger: true }))) return;
    const res = await fetch(`/api/drug-boards/cases?id=${item.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Couldn't remove it.", "error");
    onSaved();
  }

  return (
    <Dialog title={item ? item.name : "Follow a court case"} onClose={onClose}>
      <form onSubmit={save} className="db-form">
        <div className="db-form-row">
          <label className="field">State
            <select className="select" value={f.state} onChange={(e) => setF((x) => ({ ...x, state: e.target.value, board_drug_id: "" }))}>{boards.map((b) => <option key={b.state} value={b.state}>{STATE_NAMES[b.state]}</option>)}</select>
          </label>
          <label className="field">Case name
            <input className="input" value={f.name} onChange={set("name")} required placeholder="e.g. Amgen Inc. v. Mizner" />
          </label>
        </div>
        <label className="field">Court
          <input className="input" value={f.court} onChange={set("court")} placeholder="e.g. U.S. District Court for Colorado" />
        </label>
        <label className="field">CourtListener link <span className="field-optional">the easiest way to follow it</span>
          <input className="input" type="url" value={f.link} onChange={set("link")} placeholder="https://www.courtlistener.com/docket/…" />
        </label>
        <p className="muted db-form-hint">No link? Give CourtListener&apos;s court code and the docket number, and the app will look it up.</p>
        <div className="db-form-row">
          <label className="field">Court code <span className="field-optional">e.g. cod, cafc, mdd</span>
            <input className="input" value={f.court_code} onChange={set("court_code")} />
          </label>
          <label className="field">Docket number <span className="field-optional">e.g. 1:25-cv-03452</span>
            <input className="input" value={f.docket_number} onChange={set("docket_number")} />
          </label>
        </div>
        <label className="field">Drug <span className="field-optional">optional</span>
          <select className="select" value={f.board_drug_id} onChange={set("board_drug_id")}>
            <option value="">Not about one drug</option>
            {stateDrugs.map((d) => <option key={d.id} value={d.id}>{d.drug}</option>)}
          </select>
        </label>
        <label className="field">Notes <span className="field-optional">optional</span>
          <textarea className="input cl-textarea" rows={3} value={f.notes} onChange={set("notes")} />
        </label>
        <div className="db-form-actions">
          <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : item ? "Save changes" : "Follow case"}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {item && <button type="button" className="link-btn db-remove" onClick={remove}>Stop following</button>}
        </div>
      </form>
    </Dialog>
  );
}

function DrugTrack({ stage }: { stage: string }) {
  const { reached, stopped, finished } = drugTrackPosition(stage);
  const tone = drugStageTone(stage);
  return (
    <span className={`db-track route-tone-${tone}`} role="img" aria-label={`${DRUG_STAGE_LABELS[stage as DrugStage] ?? stage}: step ${reached + 1} of ${DRUG_TRACK.length}`}>
      {DRUG_TRACK.map((s, i) => (
        <span key={s} className={`db-track-dot${i < reached || (i === reached && finished) ? " is-done" : i === reached ? (stopped ? " is-stopped" : " is-current") : ""}`} />
      ))}
    </span>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog db-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 className="dialog-title">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="db-dialog-body">{children}</div>
      </div>
    </div>
  );
}

function DrugDialog({ drug, boards, defaultState, onClose, onSaved }: { drug: Drug | null; boards: Board[]; defaultState: string | null; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useUI();
  const [f, setF] = useState({
    state: drug?.state ?? defaultState ?? boards[0]?.state ?? "",
    drug: drug?.drug ?? "",
    manufacturer: drug?.manufacturer ?? "",
    stage: drug?.stage ?? "selected",
    price_limit: drug?.price_limit ?? "",
    limit_basis: drug?.limit_basis ?? "",
    next_step: drug?.next_step ?? "",
    next_date: drug?.next_date ?? "",
    source_url: drug?.source_url ?? "",
    notes: drug?.notes ?? "",
    needs_check: drug?.needs_check ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<{ id: number; changed_at: string; summary: string; by: string | null }[] | null>(null);

  useEffect(() => {
    if (!drug) return;
    fetch(`/api/drug-boards/drugs?id=${drug.id}`).then((r) => r.json()).then((b) => setHistory(b.history ?? [])).catch(() => setHistory([]));
  }, [drug]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/drug-boards/drugs", { method: drug ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(drug ? { id: drug.id, ...f } : f) });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return toast(body.error ?? "Couldn't save.", "error");
    toast(drug ? (body.changes?.length ? "Saved" : "Nothing changed") : `Added ${f.drug}`, "success");
    onSaved();
  }

  async function remove() {
    if (!drug || !(await confirm(`Take ${drug.drug} (${drug.state}) off the tracker? Its history goes with it.`, { confirmLabel: "Remove", danger: true }))) return;
    const res = await fetch(`/api/drug-boards/drugs?id=${drug.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Couldn't remove it.", "error");
    onSaved();
  }

  return (
    <Dialog title={drug ? `${drug.drug}, ${STATE_NAMES[drug.state] ?? drug.state}` : "Add a drug"} onClose={onClose}>
      <form onSubmit={save} className="db-form">
        <div className="db-form-row">
          <label className="field">Board
            <select className="select" value={f.state} onChange={set("state")}>{boards.map((b) => <option key={b.state} value={b.state}>{STATE_NAMES[b.state]}</option>)}</select>
          </label>
          <label className="field">Drug
            <input className="input" value={f.drug} onChange={set("drug")} required placeholder="e.g. Enbrel" />
          </label>
          <label className="field">Manufacturer <span className="field-optional">optional</span>
            <input className="input" value={f.manufacturer} onChange={set("manufacturer")} />
          </label>
        </div>
        <label className="field">Where it stands
          <select className="select" value={f.stage} onChange={set("stage")}>{DRUG_STAGES.map((s) => <option key={s} value={s}>{DRUG_STAGE_LABELS[s]}</option>)}</select>
        </label>
        <div className="db-form-row">
          <label className="field">Price limit <span className="field-optional">optional</span>
            <input className="input" value={f.price_limit} onChange={set("price_limit")} placeholder="e.g. $600 per dose" />
          </label>
          <label className="field">How it&apos;s set <span className="field-optional">optional</span>
            <input className="input" value={f.limit_basis} onChange={set("limit_basis")} placeholder="e.g. Medicare negotiated price" />
          </label>
        </div>
        <div className="db-form-row">
          <label className="field">Next step <span className="field-optional">optional</span>
            <input className="input" value={f.next_step} onChange={set("next_step")} placeholder="e.g. Public hearing" />
          </label>
          <label className="field">Date <span className="field-optional">optional</span>
            <input className="input" type="date" value={f.next_date} onChange={set("next_date")} />
          </label>
        </div>
        <label className="field">Source <span className="field-optional">the board document or page this comes from</span>
          <input className="input" type="url" value={f.source_url} onChange={set("source_url")} placeholder="https://" />
        </label>
        <label className="field">Notes <span className="field-optional">optional</span>
          <textarea className="input cl-textarea" rows={3} value={f.notes} onChange={set("notes")} />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={f.needs_check} onChange={set("needs_check")} /> Needs a check (sources disagree or it&apos;s unconfirmed)
        </label>
        <div className="db-form-actions">
          <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : drug ? "Save changes" : "Add drug"}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {drug && <button type="button" className="link-btn db-remove" onClick={remove}>Remove from tracker</button>}
        </div>
      </form>
      {drug && (
        <div className="db-history">
          <h3 className="cl-sub">History</h3>
          {history === null ? <div className="skel skel-row" /> : history.length === 0 ? <p className="muted">No changes recorded yet.</p> : (
            <ul>
              {history.map((h) => <li key={h.id}><span>{h.summary}</span><span className="db-sub">{formatDate(h.changed_at)}{h.by ? `, ${h.by}` : ""}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

function DateDialog({ boards, defaultState, onClose, onSaved }: { boards: Board[]; defaultState: string | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useUI();
  const [f, setF] = useState({ state: defaultState ?? boards[0]?.state ?? "", date: "", time: "", kind: "meeting", title: "Board meeting", url: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/drug-boards/dates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast(body.error ?? "Couldn't add it.", "error");
    toast("Added", "success");
    onSaved();
  }
  return (
    <Dialog title="Add a meeting or deadline" onClose={onClose}>
      <form onSubmit={save} className="db-form">
        <div className="db-form-row">
          <label className="field">Board
            <select className="select" value={f.state} onChange={set("state")}>{boards.map((b) => <option key={b.state} value={b.state}>{STATE_NAMES[b.state]}</option>)}</select>
          </label>
          <label className="field">What
            <select className="select" value={f.kind} onChange={(e) => setF((x) => ({ ...x, kind: e.target.value, title: x.title === "Board meeting" || x.title === "Comment deadline" || x.title === "Public hearing" ? ({ meeting: "Board meeting", comment_deadline: "Comment deadline", hearing: "Public hearing", other: x.title } as Record<string, string>)[e.target.value] : x.title }))}>
              <option value="meeting">Meeting</option>
              <option value="comment_deadline">Comment deadline</option>
              <option value="hearing">Hearing</option>
              <option value="other">Something else</option>
            </select>
          </label>
        </div>
        <div className="db-form-row">
          <label className="field">Date<input className="input" type="date" value={f.date} onChange={set("date")} required /></label>
          <label className="field">Time <span className="field-optional">optional</span><input className="input" value={f.time} onChange={set("time")} placeholder="2:00 PM" /></label>
        </div>
        <label className="field">Title<input className="input" value={f.title} onChange={set("title")} required /></label>
        <label className="field">Link <span className="field-optional">optional</span><input className="input" type="url" value={f.url} onChange={set("url")} placeholder="https://" /></label>
        <div className="db-form-actions">
          <button className="btn btn-primary">Add</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function BoardDialog({ board, onClose, onSaved }: { board: Board; onClose: () => void; onSaved: () => void }) {
  const { toast } = useUI();
  const [f, setF] = useState({ authority: board.authority ?? "", status: board.status, summary: board.summary ?? "", summary_source: board.summary_source ?? "", website: board.website ?? "", email_signup: board.email_signup ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/drug-boards/boards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: board.state, ...f }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast(body.error ?? "Couldn't save.", "error");
    toast("Saved for everyone", "success");
    onSaved();
  }
  return (
    <Dialog title={`Correct: ${STATE_NAMES[board.state]}`} onClose={onClose}>
      <form onSubmit={save} className="db-form">
        <div className="db-form-row">
          <label className="field">What it can do<input className="input" value={f.authority} onChange={set("authority")} placeholder="Can set price limits" /></label>
          <label className="field">Status
            <select className="select" value={f.status} onChange={set("status")}>
              <option value="active">Active</option><option value="limited">Limited (council or reporting only)</option><option value="proposed">Proposed</option><option value="dissolved">Dissolved</option>
            </select>
          </label>
        </div>
        <label className="field">Summary<textarea className="input cl-textarea" rows={3} value={f.summary} onChange={set("summary")} /></label>
        <label className="field">Where the summary comes from<input className="input" type="url" value={f.summary_source} onChange={set("summary_source")} placeholder="https://" /></label>
        <div className="db-form-row">
          <label className="field">Website<input className="input" type="url" value={f.website} onChange={set("website")} /></label>
          <label className="field">Board email list <span className="field-optional">optional</span><input className="input" type="url" value={f.email_signup} onChange={set("email_signup")} /></label>
        </div>
        <p className="muted">Board details are shared by everyone using the app.</p>
        <div className="db-form-actions">
          <button className="btn btn-primary">Save</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function PagesList({ pages, boards, onChange }: { pages: Page[]; boards: Board[]; onChange: () => void }) {
  const { toast, confirm } = useUI();
  const [f, setF] = useState({ state: boards[0]?.state ?? "", url: "", label: "" });
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/drug-boards/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast(body.error ?? "Couldn't add that page.", "error");
    toast("Added. It'll be checked with the rest.", "success");
    setF((x) => ({ ...x, url: "", label: "" }));
    onChange();
  }
  async function remove(p: Page) {
    if (!(await confirm(`Stop checking ${p.url}? Documents already found stay.`, { confirmLabel: "Stop checking", danger: true }))) return;
    const res = await fetch(`/api/drug-boards/pages?id=${p.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Couldn't remove it.", "error");
    onChange();
  }
  return (
    <div className="card db-pages-card">
      <ul className="db-pages-list">
        {pages.map((p) => (
          <li key={p.id} className={p.last_error ? "is-bad" : ""}>
            <span className="db-state">{p.state}</span>
            <span className="db-page-main">
              <a href={p.url} target="_blank" rel="noreferrer">{p.label || p.url}</a>
              <span className="db-sub">{p.last_error ? `Couldn't read it: ${p.last_error}` : p.last_checked_at ? `Checked ${timeAgo(p.last_checked_at)}${p.last_changed_at ? `. Last new document ${timeAgo(p.last_changed_at)}` : ""}` : "Not checked yet"}</span>
            </span>
            <button className="icon-btn" onClick={() => remove(p)} aria-label={`Stop checking ${p.label || p.url}`}><X size={14} /></button>
          </li>
        ))}
      </ul>
      <form className="db-addpage" onSubmit={add}>
        <label className="sr-only" htmlFor="page-state">Board</label>
        <select id="page-state" className="select" value={f.state} onChange={(e) => setF((x) => ({ ...x, state: e.target.value }))}>{boards.map((b) => <option key={b.state} value={b.state}>{b.state}</option>)}</select>
        <label className="sr-only" htmlFor="page-url">Page address</label>
        <input id="page-url" className="input" type="url" placeholder="Another board page to check, https://" value={f.url} onChange={(e) => setF((x) => ({ ...x, url: e.target.value }))} required />
        <label className="sr-only" htmlFor="page-label">Label</label>
        <input id="page-label" className="input" placeholder="Label, e.g. Meetings" value={f.label} onChange={(e) => setF((x) => ({ ...x, label: e.target.value }))} />
        <button className="btn btn-secondary btn-sm"><Plus size={14} /> Watch page</button>
      </form>
    </div>
  );
}

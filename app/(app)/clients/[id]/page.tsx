"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useUI } from "@/components/UIProvider";
import RouteLine from "@/components/ui/RouteLine";
import ClientReportView from "@/components/ClientReportView";
import { citationFor, formatDate, timeAgo } from "@/lib/billMeta";
import { STAGE_LABELS } from "@/lib/billStage";
import { POSITION_LABELS, weekOfLabel, type ClientReport, type ReportBill } from "@/lib/clientReport";
import type { ClientRow } from "@/lib/clientReportData";
import { ArrowLeft, Printer, Share2, Trash2, Plus, X, Send, Mail, Check, Copy, Pencil } from "lucide-react";

type Recipient = { id: string; email: string; name: string | null };
type SentReport = { id: string; week_of: string; sent_at: string; sent_to: string[]; sent_by: string | null; is_test: boolean };
type Detail = { client: ClientRow; bills: ReportBill[]; recipients: Recipient[]; reports: SentReport[]; team: { id: string; email: string }[] };

export default function ClientPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const { toast, confirm } = useUI();
  const id = params.id as string;

  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ClientReport | null>(null);
  const [tracked, setTracked] = useState<{ id: string; title: string }[]>([]);
  const [billInput, setBillInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [ask, setAsk] = useState("");
  const [askSaved, setAskSaved] = useState(true);
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState<"" | "real" | "test">("");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [shareOpen, setShareOpen] = useState(false);

  async function load() {
    const res = await fetch(`/api/clients/${id}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) return setError(body.error ?? "Couldn't load this client.");
    setDetail(body);
    setAsk(body.client.report_ask ?? "");
    setNotes(body.client.notes ?? "");
    setAskSaved(true);
    loadReport();
  }

  async function loadReport() {
    const res = await fetch(`/api/clients/${id}/report`).catch(() => null);
    if (res?.ok) setReport((await res.json()).report);
  }

  useEffect(() => {
    load();
    supabase
      .from("tracked_bills")
      .select("bill_id, bills(title)")
      .limit(500)
      .then(({ data }) => {
        const seen = new Set<string>();
        const list: { id: string; title: string }[] = [];
        for (const r of (data as any[]) ?? []) {
          if (seen.has(r.bill_id)) continue;
          seen.add(r.bill_id);
          const b = Array.isArray(r.bills) ? r.bills[0] : r.bills;
          list.push({ id: r.bill_id, title: b?.title ?? r.bill_id });
        }
        setTracked(list);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function patchClient(patch: Record<string, unknown>, quiet = false) {
    const res = await fetch(`/api/clients/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(body.error ?? "Couldn't save that.", "error");
      return false;
    }
    if (!quiet) toast("Saved", "success");
    return true;
  }

  async function addBill(input: { billId?: string; citation?: string }) {
    setAdding(true);
    const res = await fetch(`/api/clients/${id}/bills`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = await res.json().catch(() => ({}));
    setAdding(false);
    if (!res.ok) return toast(body.error ?? "Couldn't add that bill.", "error");
    setBillInput("");
    toast(`Added ${citationFor(body.billId)}`, "success");
    load();
  }

  async function setPosition(billId: string, position: string) {
    setDetail((d) => d && { ...d, bills: d.bills.map((b) => (b.billId === billId ? { ...b, position } : b)) });
    const res = await fetch(`/api/clients/${id}/bills`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ billId, position }) });
    if (!res.ok) toast("Couldn't change the position.", "error");
    loadReport();
  }

  async function saveNote(billId: string, note: string) {
    const res = await fetch(`/api/clients/${id}/bills`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ billId, note: note.trim() || null }) });
    if (!res.ok) toast("Couldn't save the note.", "error");
    else loadReport();
  }

  async function removeBill(billId: string) {
    if (!(await confirm(`Take ${citationFor(billId)} off this client's list?`, { confirmLabel: "Remove", danger: true }))) return;
    const res = await fetch(`/api/clients/${id}/bills?billId=${encodeURIComponent(billId)}`, { method: "DELETE" });
    if (!res.ok) return toast("Couldn't remove it.", "error");
    setDetail((d) => d && { ...d, bills: d.bills.filter((b) => b.billId !== billId) });
    loadReport();
  }

  async function addRecipient(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/clients/${id}/recipients`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name: recipientName }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast(body.error ?? "Couldn't add that address.", "error");
    setDetail((d) => d && { ...d, recipients: [...d.recipients, body.recipient] });
    setEmail("");
    setRecipientName("");
  }

  async function removeRecipient(r: Recipient) {
    const res = await fetch(`/api/clients/${id}/recipients?id=${r.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Couldn't remove that address.", "error");
    setDetail((d) => d && { ...d, recipients: d.recipients.filter((x) => x.id !== r.id) });
  }

  async function send(test: boolean) {
    if (!detail) return;
    if (!test) {
      const n = detail.recipients.length;
      if (!(await confirm(`Send this week's report to ${n} ${n === 1 ? "person" : "people"} at ${detail.client.name} now?`, { confirmLabel: "Send now" }))) return;
    }
    setSending(test ? "test" : "real");
    const res = await fetch(`/api/clients/${id}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test }) });
    const body = await res.json().catch(() => ({}));
    setSending("");
    if (!res.ok) return toast(body.error ?? "The report didn't send.", "error");
    toast(test ? "Test sent to you" : `Sent to ${body.sentTo.length} ${body.sentTo.length === 1 ? "person" : "people"}`, "success");
    load();
  }

  async function remove() {
    if (!detail) return;
    if (!(await confirm(`Delete ${detail.client.name}? Its bill list, recipients and report history go with it. Your tracked bills are not affected.`, { confirmLabel: "Delete client", danger: true }))) return;
    const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
    if (!res.ok) return toast("Couldn't delete the client.", "error");
    router.push("/clients");
  }

  const untrackedForClient = useMemo(() => {
    const on = new Set(detail?.bills.map((b) => b.billId) ?? []);
    return tracked.filter((t) => !on.has(t.id));
  }, [tracked, detail]);

  if (error) {
    return (
      <div className="page">
        <Link href="/clients" className="backlink"><ArrowLeft size={15} /> Clients</Link>
        <p className="error-text">{error}</p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="page page-wide">
        <div className="skel skel-line" style={{ width: 120 }} />
        <div className="skel skel-title" />
        <div className="cl-detail"><div className="skel skel-block" /><div className="skel skel-block" /></div>
      </div>
    );
  }

  const { client, bills, recipients, reports, team } = detail;
  const lastReal = reports.find((r) => !r.is_test);

  return (
    <div className="page page-wide client-page">
      <Link href="/clients" className="backlink no-print"><ArrowLeft size={15} /> Clients</Link>

      <header className="page-head">
        <div className="page-head-text">
          {renaming ? (
            <form
              className="cl-rename"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await patchClient({ name: newName })) {
                  setRenaming(false);
                  load();
                }
              }}
            >
              <label className="sr-only" htmlFor="client-name">Client name</label>
              <input id="client-name" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus maxLength={120} />
              <button className="btn btn-primary btn-sm">Save</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(false)}>Cancel</button>
            </form>
          ) : (
            <h1 className="page-title cl-name">
              {client.name}
              <button className="icon-btn" aria-label="Rename client" onClick={() => { setNewName(client.name); setRenaming(true); }}><Pencil size={15} /></button>
            </h1>
          )}
          <p className="page-desc">
            {bills.length} bill{bills.length === 1 ? "" : "s"}.{" "}
            <label className="cl-lead">
              Account lead{" "}
              <select className="select" value={client.lead_user_id ?? ""} onChange={async (e) => { await patchClient({ leadUserId: e.target.value || null }, true); load(); }}>
                <option value="">Nobody yet</option>
                {team.map((t) => <option key={t.id} value={t.id}>{t.email}</option>)}
              </select>
            </label>
          </p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-secondary" href={`/clients/${id}/report`}><Printer size={15} /> Print or save as PDF</Link>
          <button className="btn btn-secondary" onClick={() => setShareOpen(true)}><Share2 size={15} /> {client.share_token ? "Client link is on" : "Share with client"}</button>
          <button className="icon-btn" aria-label="Delete client" title="Delete client" onClick={remove}><Trash2 size={16} /></button>
        </div>
      </header>

      <div className="cl-detail">
        <div className="cl-col">
          <section className="card">
            <h2 className="card-title">What they care about</h2>
            <p className="card-sub">Your position on each bill for this client, and an optional note. Positions and notes appear in their report.</p>

            <form className="cl-addbill" onSubmit={(e) => { e.preventDefault(); if (billInput.trim()) addBill({ citation: billInput }); }}>
              <label className="sr-only" htmlFor="bill-number">Bill number</label>
              <input id="bill-number" className="input" placeholder="Bill number, like H.R. 1234" value={billInput} onChange={(e) => setBillInput(e.target.value)} />
              <button className="btn btn-primary btn-sm" disabled={adding || !billInput.trim()}><Plus size={14} /> Add</button>
            </form>
            {untrackedForClient.length > 0 && (
              <label className="cl-pick">
                <span className="sr-only">Add one of your tracked bills</span>
                <select className="select" value="" onChange={(e) => e.target.value && addBill({ billId: e.target.value })} disabled={adding}>
                  <option value="">Or add one of your tracked bills…</option>
                  {untrackedForClient.map((t) => <option key={t.id} value={t.id}>{citationFor(t.id)}: {t.title.slice(0, 80)}</option>)}
                </select>
              </label>
            )}

            {bills.length === 0 ? (
              <p className="muted cl-empty">No bills yet. Add the ones this client cares about and their report fills itself in.</p>
            ) : (
              <ul className="cl-bills">
                {bills.map((b) => (
                  <BillRow key={b.billId} b={b} onPosition={setPosition} onNote={saveNote} onRemove={removeBill} />
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="card-title">Team notes</h2>
            <p className="card-sub">For your team only. Never shown to the client.</p>
            <label className="sr-only" htmlFor="client-notes">Team notes</label>
            <textarea
              id="client-notes"
              className="input cl-textarea"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (client.notes ?? "") && patchClient({ notes: notes || null })}
              placeholder="Who you talk to there, what they care about most, renewal dates…"
            />
          </section>
        </div>

        <div className="cl-col">
          <section className="card cl-report">
            <div className="cl-report-head">
              <div>
                <h2 className="card-title">Monday report</h2>
                <p className="card-sub">
                  {lastReal ? `Last sent ${timeAgo(lastReal.sent_at)} to ${lastReal.sent_to.length} ${lastReal.sent_to.length === 1 ? "person" : "people"}.` : "Not sent yet."}
                </p>
              </div>
              <label className="check-row cl-auto">
                <input
                  type="checkbox"
                  checked={client.report_enabled}
                  onChange={async (e) => {
                    const on = e.target.checked;
                    if (await patchClient({ reportEnabled: on }, true)) {
                      toast(on ? "It will go out early every Monday morning" : "Automatic sending is off", "success");
                      load();
                    }
                  }}
                />
                Send automatically every Monday
              </label>
            </div>

            <div className="cl-recipients">
              <h3 className="cl-sub">Sent to</h3>
              {recipients.length === 0 ? (
                <p className="muted">Nobody yet. Add the people at {client.name} who should get it.</p>
              ) : (
                <ul className="chips">
                  {recipients.map((r) => (
                    <li key={r.id} className="chip">
                      {r.name ? `${r.name} (${r.email})` : r.email}
                      <button className="topic-x" aria-label={`Remove ${r.email}`} onClick={() => removeRecipient(r)}><X size={12} /></button>
                    </li>
                  ))}
                </ul>
              )}
              <form className="cl-addrcpt" onSubmit={addRecipient}>
                <label className="sr-only" htmlFor="rcpt-email">Email</label>
                <input id="rcpt-email" className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <label className="sr-only" htmlFor="rcpt-name">Name</label>
                <input id="rcpt-name" className="input" placeholder="Name (optional)" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
                <button className="btn btn-secondary btn-sm"><Plus size={14} /> Add</button>
              </form>
            </div>

            <div className="cl-askbox">
              <label className="cl-sub" htmlFor="client-ask">What we need from you</label>
              <textarea
                id="client-ask"
                className="input cl-textarea"
                rows={3}
                value={ask}
                onChange={(e) => { setAsk(e.target.value); setAskSaved(false); }}
                onBlur={async () => { if (!askSaved && (await patchClient({ reportAsk: ask || null }, true))) { setAskSaved(true); loadReport(); } }}
                placeholder="Optional. For example: please confirm by Thursday that you'll sign the coalition letter."
              />
              <span className="cl-saved" aria-live="polite">{askSaved ? (ask ? <><Check size={13} /> Saved. It shows at the top of the report.</> : "") : "Saves when you click away"}</span>
            </div>

            <div className="cl-send">
              <button className="btn btn-primary" onClick={() => send(false)} disabled={!!sending || recipients.length === 0}><Send size={15} /> {sending === "real" ? "Sending…" : "Send now"}</button>
              <button className="btn btn-secondary" onClick={() => send(true)} disabled={!!sending}><Mail size={15} /> {sending === "test" ? "Sending…" : "Send a test to me"}</button>
            </div>

            <h3 className="cl-sub">Preview</h3>
            {report ? <ClientReportView report={report} /> : <div className="skel skel-block" />}

            {reports.length > 0 && (
              <>
                <h3 className="cl-sub">History</h3>
                <ul className="cl-history">
                  {reports.map((r) => (
                    <li key={r.id}>
                      <span>Week of {weekOfLabel(r.week_of)}</span>
                      <span className="muted">
                        {r.is_test ? "Test" : r.sent_by ? "Sent by hand" : "Sent automatically"} {formatDate(r.sent_at)} to {r.sent_to.join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>

      {shareOpen && <ShareDialog clientId={id} clientName={client.name} token={client.share_token} onClose={() => { setShareOpen(false); load(); }} />}
    </div>
  );
}

function BillRow({ b, onPosition, onNote, onRemove }: { b: ReportBill; onPosition: (id: string, p: string) => void; onNote: (id: string, n: string) => void; onRemove: (id: string) => void }) {
  const [note, setNote] = useState(b.note ?? "");
  const [editing, setEditing] = useState(false);
  return (
    <li className="cl-bill">
      <div className="cl-bill-top">
        <span className="cite">{citationFor(b.billId)}</span>
        <label className="sr-only" htmlFor={`pos-${b.billId}`}>Position for this client</label>
        <select id={`pos-${b.billId}`} className={`pos-select pos-${b.position}`} value={b.position} onChange={(e) => onPosition(b.billId, e.target.value)}>
          {Object.entries(POSITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="icon-btn" aria-label={`Remove ${citationFor(b.billId)}`} onClick={() => onRemove(b.billId)}><X size={15} /></button>
      </div>
      <Link href={`/bill/${b.billId}`} className="cl-bill-title">{b.title}</Link>
      <div className="cl-bill-route">
        <RouteLine stage={b.stage} billType={b.billType} />
        <span>{STAGE_LABELS[b.stage] ?? b.stage}{b.latestActionDate ? `. ${formatDate(b.latestActionDate)}` : ""}</span>
      </div>
      {editing ? (
        <div className="cl-note-edit">
          <label className="sr-only" htmlFor={`note-${b.billId}`}>Note for the client</label>
          <textarea id={`note-${b.billId}`} className="input cl-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="A line for the client's report about this bill" />
          <div className="cl-note-actions">
            <button className="btn btn-primary btn-sm" onClick={() => { onNote(b.billId, note); setEditing(false); }}>Save note</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setNote(b.note ?? ""); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : note ? (
        <button className="cl-note" onClick={() => setEditing(true)}>{note}</button>
      ) : (
        <button className="link-btn cl-note-add" onClick={() => setEditing(true)}>Add a note for the client</button>
      )}
    </li>
  );
}

function ShareDialog({ clientId, clientName, token, onClose }: { clientId: string; clientName: string; token: string | null; onClose: () => void }) {
  const { toast } = useUI();
  const [url, setUrl] = useState<string | null>(token ? `${window.location.origin}/share/client/${token}` : null);
  const [on, setOn] = useState(!!token);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function set(enable: boolean) {
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: enable }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(body.error ?? "Couldn't change the link.", "error");
    setOn(enable);
    setUrl(body.url);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog dialog-sm" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="share-title" className="dialog-title">Share with {clientName}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="cal-body">
          <p>A read-only page with this week&apos;s report that stays current. No account needed. Your team notes and other clients are never on it.</p>
          {on ? (
            <>
              {url && (
                <div className="cal-link">
                  <input className="input" readOnly value={url} aria-label="Client link" onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
                    {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
              <p className="muted">Making a new link stops the old one working, if it was forwarded somewhere it shouldn&apos;t be.</p>
              <div className="cl-send">
                <button className="btn btn-secondary btn-sm" onClick={() => set(true)} disabled={busy}>Make a new link</button>
                <button className="btn btn-ghost btn-sm" onClick={() => set(false)} disabled={busy}>Turn the link off</button>
              </div>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => set(true)} disabled={busy}><Share2 size={15} /> Create the link</button>
          )}
        </div>
      </div>
    </div>
  );
}

// SERVER-ONLY. One email to everyone who asked for drug board alerts when
// boards post new documents, change the wording of a page we watch, a court
// case gets a new filing, or state bills move. Runs in the daily alert
// job. Everything gathered is marked as sent even when nobody has opted in,
// so turning alerts on later never delivers a months-old backlog.

import { Resend } from "resend";
import { drugBoardEmail } from "@/lib/emailTemplate";

type Admin = any;

const MAX_ITEMS = 40;

export async function sendDrugBoardAlerts(admin: Admin): Promise<{ documents: number; bills: number; pageChanges: number; filings: number; recipients: number; sent: number; skipped?: string }> {
  // Mentions come from migration 0006; older databases just don't have them.
  let { data: docs, error } = await admin
    .from("board_documents")
    .select("id, state, title, url, kind, doc_date, mentions")
    .is("notified_at", null)
    .eq("baseline", false)
    .order("first_seen_at", { ascending: true })
    .limit(MAX_ITEMS);
  if (error) {
    ({ data: docs, error } = await admin
      .from("board_documents")
      .select("id, state, title, url, kind, doc_date")
      .is("notified_at", null)
      .eq("baseline", false)
      .order("first_seen_at", { ascending: true })
      .limit(MAX_ITEMS));
  }
  if (error) return { documents: 0, bills: 0, pageChanges: 0, filings: 0, recipients: 0, sent: 0, skipped: "drug board tables not set up yet" };
  const { data: bills } = await admin
    .from("state_bills")
    .select("id, state, identifier, title, latest_action, url")
    .is("notified_at", null)
    .eq("hidden", false)
    .order("latest_action_date", { ascending: false })
    .limit(MAX_ITEMS);

  const { data: changes } = await admin
    .from("board_page_changes")
    .select("id, state, added, removed, board_pages(url, label)")
    .is("notified_at", null)
    .order("detected_at", { ascending: true })
    .limit(MAX_ITEMS);
  const { data: filings } = await admin
    .from("board_case_filings")
    .select("id, date_filed, description, url, board_cases(name, state)")
    .is("notified_at", null)
    .eq("baseline", false)
    .order("date_filed", { ascending: true })
    .limit(MAX_ITEMS);

  const d = (docs as any[]) ?? [];
  const b = (bills as any[]) ?? [];
  const c = (changes as any[]) ?? [];
  const f = (filings as any[]) ?? [];
  if (!d.length && !b.length && !c.length && !f.length) return { documents: 0, bills: 0, pageChanges: 0, filings: 0, recipients: 0, sent: 0 };

  let recipients = 0;
  let sent = 0;
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    const { data: people } = await admin.from("profiles").select("id, email").eq("drug_board_alerts", true).eq("email_notifications_enabled", true);
    const resend = new Resend(process.env.RESEND_API_KEY);
    for (const p of (people as any[]) ?? []) {
      if (!p.email) continue;
      recipients++;
      const email = drugBoardEmail({
        userId: p.id,
        documents: d.map((x) => ({ state: x.state, title: x.title ?? x.url, url: x.url, kind: x.kind, date: x.doc_date, mentions: x.mentions ?? [] })),
        pageChanges: c.map((x) => ({ state: x.state, page: x.board_pages?.label || x.board_pages?.url || "Board page", url: x.board_pages?.url ?? null, added: x.added, removed: x.removed })),
        filings: f.map((x) => ({ state: x.board_cases?.state ?? "", caseName: x.board_cases?.name ?? "Court case", description: x.description, date: x.date_filed, url: x.url })),
        bills: b.map((x) => ({ state: x.state, identifier: x.identifier, title: x.title, latestAction: x.latest_action, url: x.url })),
      });
      const { error: sendError } = await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL!, to: p.email, subject: email.subject, html: email.html, text: email.text });
      if (!sendError) sent++;
      else console.error("drug board alert failed", sendError);
    }
  }

  const now = new Date().toISOString();
  if (d.length) await admin.from("board_documents").update({ notified_at: now }).in("id", d.map((x) => x.id));
  if (b.length) await admin.from("state_bills").update({ notified_at: now }).in("id", b.map((x) => x.id));
  if (c.length) await admin.from("board_page_changes").update({ notified_at: now }).in("id", c.map((x) => x.id));
  if (f.length) await admin.from("board_case_filings").update({ notified_at: now }).in("id", f.map((x) => x.id));
  return { documents: d.length, bills: b.length, pageChanges: c.length, filings: f.length, recipients, sent };
}

// SERVER-ONLY. Sending the Monday client report, by hand or on schedule.

import { Resend } from "resend";
import { buildReportFor, CLIENT_COLUMNS, type ClientRow } from "@/lib/clientReportData";
import { clientReportEmail } from "@/lib/emailTemplate";
import { weekMonday } from "@/lib/houseFloor";
import { deadline } from "@/lib/batch";
import type { ClientReport } from "@/lib/clientReport";

type Admin = any;

export function clientShareUrl(token: string | null): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return token && appUrl ? `${appUrl.replace(/\/$/, "")}/share/client/${token}` : null;
}

async function leadContact(admin: Admin, client: ClientRow): Promise<string | null> {
  if (!client.lead_user_id) return null;
  const { data } = await admin.from("profiles").select("email").eq("id", client.lead_user_id).maybeSingle();
  return data?.email ?? null;
}

/**
 * Sends one client's report and records it. `to` overrides the client's
 * recipient list (used for "send a test to me").
 */
export async function sendClientReport(
  admin: Admin,
  client: ClientRow,
  opts: { to?: string[]; sentBy: string | null; isTest: boolean; replyTo?: string | null; report?: ClientReport },
): Promise<{ sentTo: string[]; report: ClientReport }> {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) throw new Error("Email isn't set up yet. Add the Resend settings in Vercel first.");

  let to = opts.to;
  if (!to) {
    const { data } = await admin.from("client_recipients").select("email").eq("client_id", client.id);
    to = ((data as any[]) ?? []).map((r) => r.email);
  }
  to = Array.from(new Set(to.filter((e) => /.+@.+\..+/.test(e))));
  if (!to.length) throw new Error("Add at least one person to send the report to.");

  const report = opts.report ?? (await buildReportFor(admin, client));
  const lead = await leadContact(admin, client);
  const replyTo = opts.replyTo ?? lead ?? undefined;
  const email = clientReportEmail(report, { replyName: replyTo ?? null, shareUrl: clientShareUrl(client.share_token) });

  const resend = new Resend(process.env.RESEND_API_KEY);
  // One message per recipient so clients never see each other's addresses.
  const failures: string[] = [];
  for (const address of to) {
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: address,
      replyTo,
      subject: opts.isTest ? `[Test] ${email.subject}` : email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) failures.push(`${address}: ${error.message}`);
  }
  const sentTo = to.filter((a) => !failures.some((f) => f.startsWith(`${a}:`)));
  if (!sentTo.length) throw new Error(`The report didn't send. ${failures[0] ?? ""}`.trim());

  await admin.from("client_reports").insert({
    client_id: client.id,
    week_of: report.weekOf,
    sent_to: sentTo,
    sent_by: opts.sentBy,
    is_test: opts.isTest,
    payload: report,
  });
  return { sentTo, report };
}

/** The Monday run: every client with automatic sending on that hasn't had this week's report yet. */
export async function sendScheduledClientReports(admin: Admin, budgetMs: number) {
  const clock = deadline(budgetMs);
  const weekOf = weekMonday();
  const { data: clients, error } = await admin.from("clients").select(CLIENT_COLUMNS).eq("report_enabled", true);
  if (error) return { clients: 0, sent: 0, skipped: 0, failed: 0, note: "clients table not set up yet" };

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const client of (clients as ClientRow[]) ?? []) {
    if (clock.expired()) break;
    const { data: already } = await admin.from("client_reports").select("id").eq("client_id", client.id).eq("week_of", weekOf).eq("is_test", false).limit(1);
    if (already?.length) {
      skipped++;
      continue;
    }
    try {
      await sendClientReport(admin, client, { sentBy: null, isTest: false });
      sent++;
    } catch (err) {
      failed++;
      console.error(`client report failed for ${client.id}`, err);
    }
  }
  return { clients: clients?.length ?? 0, sent, skipped, failed };
}

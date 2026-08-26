// SERVER-ONLY. Weekly email digest of new "worth tracking" matches -
// bills topic-discovery found in the last 7 days that are still sitting
// un-reviewed (not dismissed, not tracked yet). Called once a week from
// the existing daily notify cron (see the day-of-week gate in
// app/api/cron/notify/route.ts) rather than registering a separate cron,
// per the project's own guidance about not multiplying scheduled jobs.
//
// Reuses the same `email_notifications_enabled` opt-in as bill-update
// emails - one master email switch, not a second toggle to discover and
// forget to turn on. If this needs its own on/off later, that's a
// one-column migration away.

import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { weeklyDigestEmail } from "@/lib/emailTemplate";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BILLS_PER_DIGEST = 12; // keep the email skimmable, not a wall of rows

type DigestBill = { billId: string; title: string; matchedTopic: string };

export async function sendWeeklyDigests(): Promise<{ recipients: number; sent: number }> {
  const admin = createAdminClient();
  const resend = new Resend(process.env.RESEND_API_KEY);
  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  // Everything still worth a look: not dismissed (dismissing something -
  // including tracking it, which also sets dismissed - is the signal that
  // it's been reviewed, so a re-review email would be noise), discovered
  // in the last week.
  const { data: rows, error } = await admin
    .from("prospective_bills")
    .select("bill_id, matched_topic, organization_id, user_id, discovered_at, bills(title)")
    .eq("dismissed", false)
    .gte("discovered_at", since)
    .order("discovered_at", { ascending: false });

  if (error) {
    console.error("weekly digest: failed to load prospective bills", error);
    return { recipients: 0, sent: 0 };
  }
  if (!rows || rows.length === 0) return { recipients: 0, sent: 0 };

  // Group by owner (org or solo user) - same "org XOR user" pattern as
  // everywhere else prospective_bills is used.
  const byOrg = new Map<string, DigestBill[]>();
  const bySoloUser = new Map<string, DigestBill[]>();
  for (const r of rows) {
    const bill = Array.isArray(r.bills) ? r.bills[0] : r.bills;
    const entry: DigestBill = { billId: r.bill_id, title: bill?.title ?? r.bill_id, matchedTopic: r.matched_topic };
    if (r.organization_id) {
      const list = byOrg.get(r.organization_id) ?? [];
      list.push(entry);
      byOrg.set(r.organization_id, list);
    } else if (r.user_id) {
      const list = bySoloUser.get(r.user_id) ?? [];
      list.push(entry);
      bySoloUser.set(r.user_id, list);
    }
  }

  let recipients = 0;
  let sent = 0;

  // Org owners: every team member with email notifications on gets the
  // same digest - it's the org's shared discovery list, same as the page.
  for (const [orgId, bills] of byOrg) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, email_notifications_enabled")
      .eq("organization_id", orgId);
    for (const profile of profiles ?? []) {
      if (!profile.email_notifications_enabled || !profile.email) continue;
      recipients++;
      if (await sendOneDigest(resend, profile.id, profile.email, bills)) sent++;
    }
  }

  // Solo (no-org) users.
  for (const [userId, bills] of bySoloUser) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, email_notifications_enabled")
      .eq("id", userId)
      .single();
    if (!profile?.email_notifications_enabled || !profile.email) continue;
    recipients++;
    if (await sendOneDigest(resend, profile.id, profile.email, bills)) sent++;
  }

  return { recipients, sent };
}

async function sendOneDigest(resend: Resend, userId: string, email: string, bills: DigestBill[]): Promise<boolean> {
  try {
    const { html, text } = weeklyDigestEmail({ bills: bills.slice(0, MAX_BILLS_PER_DIGEST), totalCount: bills.length, userId });
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: email,
      subject: bills.length === 1 ? "1 new bill worth a look" : `${bills.length} new bills worth a look`,
      html,
      text,
    });
    return true;
  } catch (err) {
    console.error(`weekly digest: send failed for ${userId}`, err);
    return false;
  }
}

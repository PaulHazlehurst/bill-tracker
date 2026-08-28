import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { billUpdateEmail } from "@/lib/emailTemplate";
import { sendWeeklyDigests } from "@/lib/weeklyDigest";

export async function GET(req: NextRequest) {
  // See app/api/cron/poll/route.ts for why both a header and a query param
  // are accepted here.
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const authorized =
    auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET;
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data: events, error } = await supabase
    .from("bill_events")
    .select("id, bill_id, summary, event_type, bills(title)")
    .is("notified_at", null)
    .limit(100);

  if (error) {
    console.error("failed to load events", error);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }

  let emailsSent = 0;
  let smsSent = 0;
  let emailsSkippedNoOptIn = 0;

  // ---------------------------------------------------------------------
  // Batch the lookups ONCE for the whole run, instead of per event.
  //
  // This loop used to query tracked_bills and profiles inside the per-event
  // loop, then update each event individually - up to 100 events x 3 queries
  // = ~300 sequential round-trips per run, re-fetching the same trackers
  // repeatedly whenever one bill had several events. That was the app's
  // biggest scaling risk as the team and the bill list grow. Now it's three
  // queries total, no matter how many events are in the batch.
  //
  // NOTE: this deliberately does NOT embed profiles(email, phone) from
  // tracked_bills - there's no foreign key between those two tables (both
  // reference auth.users, not each other), so that embed silently returns
  // nothing and every send gets skipped. Fetch separately, match in code.
  // ---------------------------------------------------------------------
  const allBillIds = Array.from(new Set((events ?? []).map((e) => e.bill_id)));

  const { data: allTrackers } = allBillIds.length
    ? await supabase
        .from("tracked_bills")
        .select("bill_id, user_id, notify_email, notify_sms")
        .in("bill_id", allBillIds)
    : { data: [] as any[] };

  const allUserIds = Array.from(new Set((allTrackers ?? []).map((t) => t.user_id)));
  const { data: allProfiles } = allUserIds.length
    ? await supabase.from("profiles").select("id, email, phone, email_notifications_enabled").in("id", allUserIds)
    : { data: [] as any[] };

  const profileById = new Map((allProfiles ?? []).map((p) => [p.id, p]));
  const trackersByBill = new Map<string, any[]>();
  for (const t of allTrackers ?? []) {
    const list = trackersByBill.get(t.bill_id) ?? [];
    list.push(t);
    trackersByBill.set(t.bill_id, list);
  }

  for (const event of events ?? []) {
    const trackers = trackersByBill.get(event.bill_id) ?? [];
    const billTitle = Array.isArray(event.bills) ? event.bills[0]?.title : (event.bills as any)?.title;

    for (const t of trackers) {
      const profile = profileById.get(t.user_id);
      if (!profile) continue;

      if (t.notify_email && profile.email) {
        // The actual opt-in gate: a person can have notify_email = true on
        // a specific bill (that's their per-bill preference) but still
        // never receive anything unless they've separately turned on email
        // notifications at all, in Settings. Off by default.
        if (!profile.email_notifications_enabled) {
          emailsSkippedNoOptIn++;
        } else {
          try {
            const { html, text } = billUpdateEmail({
              billTitle: billTitle ?? event.bill_id,
              billId: event.bill_id,
              summary: event.summary,
              userId: t.user_id,
            });
            await resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL!,
              to: profile.email,
              subject: `Bill update: ${billTitle ?? event.bill_id}`,
              html,
              text,
            });
            emailsSent++;
          } catch (err) {
            console.error("email send failed", err);
          }
        }
      }

      if (t.notify_sms && profile.phone) {
        try {
          await sendSms(profile.phone, `${event.bill_id}: ${event.summary}`);
          smsSent++;
        } catch (err) {
          console.error("sms send failed", err);
        }
      }
    }
  }

  // One bulk update to close out the whole batch, rather than one UPDATE per
  // event inside the loop.
  const processedIds = (events ?? []).map((e) => e.id);
  if (processedIds.length > 0) {
    await supabase
      .from("bill_events")
      .update({ notified_at: new Date().toISOString() })
      .in("id", processedIds);
  }

  // Weekly discovery digest, folded into this daily cron rather than a
  // separate scheduled job (see the project note about not registering a
  // third Vercel cron). Gated to one day a week - Monday, UTC - so it
  // reads as "your week ahead," not a repeat of yesterday's run.
  let digest: { recipients: number; sent: number } | null = null;
  if (new Date().getUTCDay() === 1) {
    try {
      digest = await sendWeeklyDigests();
    } catch (err) {
      console.error("weekly digest run failed", err);
    }
  }

  return NextResponse.json({ eventsProcessed: events?.length ?? 0, emailsSent, smsSent, emailsSkippedNoOptIn, digest });
}

async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER!;

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`twilio send failed: ${res.status}`);
}

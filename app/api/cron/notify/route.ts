import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { billUpdateEmail } from "@/lib/emailTemplate";

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

  for (const event of events ?? []) {
    // NOTE: this does NOT try to embed profiles(email, phone) from
    // tracked_bills - there's no foreign key between those two tables
    // (both reference auth.users, not each other), so that embed silently
    // returns nothing and every send gets skipped. This was a real bug:
    // notifications have likely never actually been delivered because of
    // it. Fixed by fetching trackers and profiles separately and matching
    // them in code, same fix as the team page's tracker-email lookup.
    const { data: trackers } = await supabase
      .from("tracked_bills")
      .select("user_id, notify_email, notify_sms")
      .eq("bill_id", event.bill_id);

    const userIds = Array.from(new Set((trackers ?? []).map((t) => t.user_id)));
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("id, email, phone, email_notifications_enabled").in("id", userIds)
      : { data: [] as any[] };

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const billTitle = Array.isArray(event.bills) ? event.bills[0]?.title : (event.bills as any)?.title;

    for (const t of trackers ?? []) {
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

    await supabase.from("bill_events").update({ notified_at: new Date().toISOString() }).eq("id", event.id);
  }

  return NextResponse.json({ eventsProcessed: events?.length ?? 0, emailsSent, smsSent, emailsSkippedNoOptIn });
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

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";

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

  for (const event of events ?? []) {
    const { data: trackers } = await supabase
      .from("tracked_bills")
      .select("notify_email, notify_sms, profiles(email, phone)")
      .eq("bill_id", event.bill_id);

    for (const t of trackers ?? []) {
      const profile = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
      if (!profile) continue;

      const billTitle = Array.isArray(event.bills) ? event.bills[0]?.title : (event.bills as any)?.title;

      if (t.notify_email && profile.email) {
        try {
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL!,
            to: profile.email,
            subject: `Bill update: ${billTitle ?? event.bill_id}`,
            text: event.summary,
          });
          emailsSent++;
        } catch (err) {
          console.error("email send failed", err);
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

  return NextResponse.json({ eventsProcessed: events?.length ?? 0, emailsSent, smsSent });
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

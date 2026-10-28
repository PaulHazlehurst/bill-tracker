import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { billUpdatesEmail, type DigestBillUpdate } from "@/lib/emailTemplate";
import { sendWeeklyDigests } from "@/lib/weeklyDigest";
import { runDiscoveryForAllOwners } from "@/lib/topicDiscovery";
import { runRegDiscoveryForAllOwners } from "@/lib/regulationDiscovery";
import { deadline } from "@/lib/batch";
import { startJobRun, finishJobRun, checkAndAlert } from "@/lib/jobLog";
import { sendScheduledClientReports } from "@/lib/clientReportSend";
import { syncBoardReading } from "@/lib/boardReadingSync";
import { sendDrugBoardAlerts } from "@/lib/drugBoardAlerts";

export const maxDuration = 60;

const TOTAL_BUDGET_MS = 52_000;
// Below this there isn't time to finish even one owner - skip and let the
// next run (with a smaller notification backlog) do it.
const MIN_DISCOVERY_MS = 8_000;
const MAX_EVENTS = 400;

function citationFor(billId: string) {
  const [type, number] = billId.split("-");
  const pretty: Record<string, string> = { hr: "H.R.", s: "S.", hjres: "H.J.Res.", sjres: "S.J.Res.", hconres: "H.Con.Res.", sconres: "S.Con.Res.", hres: "H.Res.", sres: "S.Res." };
  return `${pretty[type] ?? type.toUpperCase()} ${number}`;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const authorized = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const clock = deadline(TOTAL_BUDGET_MS);
  const admin = createAdminClient();
  const runId = await startJobRun(admin, "notify");

  try {
    const summary = await runNotify(admin, clock);
    await finishJobRun(admin, runId, { ok: true, summary });
    return NextResponse.json(summary);
  } catch (err: any) {
    const message = String(err?.message ?? err);
    console.error("notify: run failed", err);
    await finishJobRun(admin, runId, { ok: false, error: message });
    return NextResponse.json({ error: "notify failed", detail: message }, { status: 500 });
  }
}

async function runNotify(admin: ReturnType<typeof createAdminClient>, clock: ReturnType<typeof deadline>) {
  // First: did this morning's congress.gov check run and finish? If not,
  // whoever gets failure alerts hears about it now rather than days later.
  const watchdog = await checkAndAlert(admin, "poll").catch(() => null);

  const emailConfigured = !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL;
  const smsConfigured = !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_FROM_NUMBER;
  const resend = emailConfigured ? new Resend(process.env.RESEND_API_KEY) : null;

  // Try to read the real action date; fall back if the migration hasn't run.
  let { data: events, error } = await admin
    .from("bill_events")
    .select("id, bill_id, summary, event_type, occurred_at, action_date, bills(title)")
    .is("notified_at", null)
    .order("occurred_at", { ascending: true })
    .limit(MAX_EVENTS);
  if (error && /action_date/.test(error.message)) {
    ({ data: events, error } = await admin
      .from("bill_events")
      .select("id, bill_id, summary, event_type, occurred_at, bills(title)")
      .is("notified_at", null)
      .order("occurred_at", { ascending: true })
      .limit(MAX_EVENTS) as any);
  }
  if (error) throw new Error(`couldn't load events: ${error.message}`);

  const list = (events as any[]) ?? [];
  const billIds = Array.from(new Set(list.map((e) => e.bill_id)));
  const { data: trackers } = billIds.length
    ? await admin.from("tracked_bills").select("bill_id, user_id, notify_email, notify_sms").in("bill_id", billIds)
    : { data: [] as any[] };
  const userIds = Array.from(new Set((trackers ?? []).map((t: any) => t.user_id)));
  // No FK between tracked_bills and profiles (both reference auth.users), so
  // they're fetched separately and matched in code.
  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("id, email, phone, email_notifications_enabled").in("id", userIds)
    : { data: [] as any[] };
  const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  const eventsByBill = new Map<string, any[]>();
  for (const e of list) {
    const arr = eventsByBill.get(e.bill_id) ?? [];
    arr.push(e);
    eventsByBill.set(e.bill_id, arr);
  }

  // Group everything per person, so each person gets one email and at most
  // one text no matter how many bills or changes there were.
  type Bundle = { email: DigestBillUpdate[]; sms: string[] };
  const bundles = new Map<string, Bundle>();
  for (const t of trackers ?? []) {
    const evs = eventsByBill.get(t.bill_id);
    if (!evs || evs.length === 0) continue;
    const b = bundles.get(t.user_id) ?? { email: [], sms: [] };
    const title = (Array.isArray(evs[0].bills) ? evs[0].bills[0]?.title : evs[0].bills?.title) ?? t.bill_id;
    if (t.notify_email) {
      b.email.push({
        billId: t.bill_id,
        title,
        citation: citationFor(t.bill_id),
        changes: evs.map((e) => ({ summary: e.summary, type: e.event_type, date: e.action_date ?? String(e.occurred_at).slice(0, 10) })),
      });
    }
    if (t.notify_sms) {
      const lead = evs.find((e) => e.event_type === "status_change") ?? evs[evs.length - 1];
      b.sms.push(`${citationFor(t.bill_id)}: ${lead.summary}`);
    }
    bundles.set(t.user_id, b);
  }

  let emailsSent = 0;
  let smsSent = 0;
  let emailsSkippedNoOptIn = 0;
  let sendFailures = 0;

  for (const [userId, bundle] of bundles) {
    const profile = profileById.get(userId);
    if (!profile) continue;

    if (bundle.email.length > 0 && profile.email) {
      if (!profile.email_notifications_enabled) emailsSkippedNoOptIn++;
      else if (resend) {
        try {
          const { html, text, subject } = billUpdatesEmail({ bills: bundle.email, userId });
          const { error: sendError } = await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL!, to: profile.email, subject, html, text });
          if (sendError) throw new Error(sendError.message);
          emailsSent++;
        } catch (err) {
          sendFailures++;
          console.error("notify: email send failed", err);
        }
      }
    }

    if (bundle.sms.length > 0 && profile.phone && smsConfigured) {
      const body =
        bundle.sms.length === 1
          ? bundle.sms[0]
          : `${bundle.sms.length} bills moved: ${bundle.sms.slice(0, 3).join(" | ")}${bundle.sms.length > 3 ? " | ..." : ""}`;
      try {
        await sendSms(profile.phone, `Bill Tracker - ${body}`.slice(0, 320));
        smsSent++;
      } catch (err) {
        sendFailures++;
        console.error("notify: sms send failed", err);
      }
    }
  }

  // Close out the whole batch in one write.
  if (list.length > 0) {
    await admin.from("bill_events").update({ notified_at: new Date().toISOString() }).in("id", list.map((e) => e.id));
  }

  // Weekly discovery digest, Mondays (UTC), folded into this cron rather
  // than registering a third one.
  let digest: { recipients: number; sent: number } | null = null;
  if (new Date().getUTCDay() === 1 && emailConfigured) {
    try {
      digest = await sendWeeklyDigests();
    } catch (err) {
      console.error("weekly digest run failed", err);
    }
  }

  // Monday client reports, for clients with automatic sending turned on.
  // Before discovery, because a client waiting on their report matters more
  // than a new suggestion.
  let clientReports: Awaited<ReturnType<typeof sendScheduledClientReports>> | null = null;
  if (emailConfigured && isMondayInWashington(new Date()) && clock.remainingMs() > 15_000) {
    try {
      clientReports = await sendScheduledClientReports(admin, Math.min(20_000, clock.remainingMs() - 10_000));
    } catch (err) {
      console.error("client reports run failed", err);
    }
  }

  // Open the board documents found at 6:00 and check court cases, so this
  // morning's email can say which drugs they mention. Capped so discovery
  // below still gets its share.
  let boardReading: Awaited<ReturnType<typeof syncBoardReading>> | null = null;
  if (clock.remainingMs() > 30_000) {
    try {
      boardReading = await syncBoardReading(admin, Math.min(18_000, clock.remainingMs() - 24_000));
    } catch (err) {
      console.error("drug board reading failed", err);
    }
  }

  // Anything new from state drug affordability boards (opt-in email).
  let drugBoards: Awaited<ReturnType<typeof sendDrugBoardAlerts>> | null = null;
  if (clock.remainingMs() > 12_000) {
    try {
      drugBoards = await sendDrugBoardAlerts(admin);
    } catch (err) {
      console.error("drug board alerts failed", err);
    }
  }

  // Topic discovery gets whatever time is left, split with regulation
  // discovery. Both are wrapped so a problem there can never break alerts.
  let discovery: Awaited<ReturnType<typeof runDiscoveryForAllOwners>> | null = null;
  const remaining = clock.remainingMs();
  const billBudget = Math.floor(remaining * 0.7);
  if (billBudget >= MIN_DISCOVERY_MS) {
    try {
      discovery = await runDiscoveryForAllOwners(billBudget);
    } catch (err) {
      console.error("topic discovery failed", err);
    }
  }

  let regDiscovery: Awaited<ReturnType<typeof runRegDiscoveryForAllOwners>> | null = null;
  if (clock.remainingMs() >= MIN_DISCOVERY_MS) {
    try {
      regDiscovery = await runRegDiscoveryForAllOwners(clock.remainingMs() - 1_000);
    } catch (err) {
      console.error("regulation discovery failed", err);
    }
  }

  return {
    watchdog,
    eventsProcessed: list.length,
    people: bundles.size,
    emailsSent,
    smsSent,
    emailsSkippedNoOptIn,
    sendFailures,
    emailConfigured,
    smsConfigured,
    digest,
    clientReports,
    boardReading,
    drugBoards,
    discovery,
    regDiscovery,
    ms: clock.elapsedMs(),
  };
}

function isMondayInWashington(d: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d) === "Mon";
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

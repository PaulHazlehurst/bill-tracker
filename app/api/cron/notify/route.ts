import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { billUpdateEmail } from "@/lib/emailTemplate";
import { sendWeeklyDigests } from "@/lib/weeklyDigest";
import { runDiscoveryForAllOwners } from "@/lib/topicDiscovery";
import { runRegDiscoveryForAllOwners } from "@/lib/regulationDiscovery";
import { deadline } from "@/lib/batch";

// Same reasoning as the poll cron: without an explicit value Vercel applies
// a short default and kills the function mid-run.
export const maxDuration = 60;

// Total wall-clock allowance, kept under maxDuration so the run always ends
// on a clean write rather than being cut off by the platform.
const TOTAL_BUDGET_MS = 50_000;
// Never hand discovery less than this - below it, it can't finish even one
// owner, so it's better to skip it entirely this cycle and let the next run
// (with a smaller notification backlog) do the work.
const MIN_DISCOVERY_MS = 8_000;

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

  const clock = deadline(TOTAL_BUDGET_MS);
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

  // Topic discovery. This used to live at the end of the POLL cron, where it
  // was unreachable in practice: polling 200 bills one at a time consumed
  // the whole function timeout before discovery was ever reached, which is
  // why suggestions only ever appeared when someone clicked "Check now" by
  // hand. It runs here instead, where the work above it is now a handful of
  // batched queries, and it gets an explicit time budget so it degrades by
  // covering fewer owners rather than by being killed.
  //
  // Wrapped so a discovery problem can never break notifications.
  //
  // The budget is whatever is LEFT of this function's allowance after the
  // notification work above, not a fixed number - on a heavy morning
  // (lots of events, lots of emails) discovery gets less time and covers
  // fewer owners; on a quiet one it gets nearly the whole minute. Owners
  // are rotated by day, so anyone skipped is first in line next time.
  let discovery: Awaited<ReturnType<typeof runDiscoveryForAllOwners>> | null = null;
  // Split the remaining time budget between bill discovery and regulation
  // discovery. The 65/35 split leans toward bills because they're more
  // conversational (topics move more frequently on the legislative side)
  // and because regulation discovery is cheaper per owner (one FR API call
  // per topic vs. several congress.gov calls per candidate).
  const remaining = clock.remainingMs();
  const billBudget = Math.floor(remaining * 0.65);
  const regBudget = remaining - billBudget;
  if (billBudget >= MIN_DISCOVERY_MS) {
    try {
      discovery = await runDiscoveryForAllOwners(billBudget);
    } catch (err) {
      console.error("topic discovery failed", err);
    }
  } else {
    console.warn(`skipping bill discovery: only ${billBudget}ms left in budget`);
  }

  // Federal regulation discovery. Same pattern, own budget. Wrapped so an
  // FR API blip can never break notifications or bill discovery.
  let regDiscovery: Awaited<ReturnType<typeof runRegDiscoveryForAllOwners>> | null = null;
  const regBudgetActual = clock.remainingMs(); // recompute in case bills ran long
  if (regBudgetActual >= MIN_DISCOVERY_MS) {
    try {
      regDiscovery = await runRegDiscoveryForAllOwners(Math.min(regBudgetActual, regBudget + 2000));
    } catch (err) {
      console.error("regulation discovery failed", err);
    }
  } else {
    console.warn(`skipping reg discovery: only ${regBudgetActual}ms left in budget`);
  }

  return NextResponse.json({
    eventsProcessed: events?.length ?? 0,
    emailsSent,
    smsSent,
    emailsSkippedNoOptIn,
    digest,
    discovery,
    regDiscovery,
    ms: clock.elapsedMs(),
  });
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

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { loadWeekView, loadDeadlines } from "@/lib/weekData";
import { weekMonday, FLOOR_CATEGORY_LABELS } from "@/lib/houseFloor";
import { weekHeadline, reasonsFor } from "@/lib/weekAhead";
import { weekAheadEmail } from "@/lib/emailTemplate";

export const maxDuration = 30;

// POST { start } - emails the week to your team. Teammates only receive it
// if they've turned on email in Settings (the same switch as bill alerts);
// you always get a copy, since you asked for it.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return NextResponse.json({ error: "Email isn't set up yet. Add the Resend settings in Vercel first." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const start = typeof body.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.start) ? weekMonday(new Date(`${body.start}T12:00:00Z`)) : weekMonday();

  const { ctx, view } = await loadWeekView(supabase, user.id, start, "mine");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const deadlines = (await loadDeadlines(supabase, ctx, user.id, today, 14)).slice(0, 5);

  const { data: people } = await supabase.from("profiles").select("id, email, email_notifications_enabled").in("id", ctx.memberIds);
  const recipients = new Set<string>();
  let skipped = 0;
  for (const p of (people as any[]) ?? []) {
    if (!p.email) continue;
    if (p.id === user.id || p.email_notifications_enabled) recipients.add(p.email);
    else skipped++;
  }
  if (user.email) recipients.add(user.email);

  const email = weekAheadEmail({
    start,
    headline: weekHeadline(view),
    senderName: user.email ?? "A teammate",
    days: view.days.map((d) => ({
      label: new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
      events: d.events.map((e) => ({ time: e.time, kind: e.kind, title: e.title, committees: e.committees, bills: e.bills.map((b) => b.citation), why: reasonsFor(e), status: e.status })),
    })),
    floor: view.floor.map((f) => ({ citation: f.citation, title: f.title, how: FLOOR_CATEGORY_LABELS[f.category] })),
    deadlines: deadlines.map((d) => ({ title: d.title, closes: d.closes, agency: d.agency })),
  });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: Array.from(recipients),
      replyTo: user.email ?? undefined,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) throw new Error(error.message);
  } catch (err: any) {
    console.error("week email failed", err);
    return NextResponse.json({ error: `The email didn't send: ${err?.message ?? "unknown error"}` }, { status: 502 });
  }
  return NextResponse.json({ sent: recipients.size, skipped });
}

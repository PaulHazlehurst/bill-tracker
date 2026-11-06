import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";

// Calls outside services; Vercel's short default limit can cut it off.
export const maxDuration = 30;

// POST - sends a one-off test email to the signed-in user's own address.
// This bypasses the email_notifications_enabled opt-in gate on purpose:
// clicking "Send test email" IS the explicit, in-the-moment request - it's
// not the same thing as the automated per-bill notifications that gate
// requires consent for ahead of time.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return NextResponse.json({ error: "Email isn't configured yet - RESEND_API_KEY or RESEND_FROM_EMAIL is missing." }, { status: 500 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const sentAt = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: user.email,
      subject: "Bill Tracker: test email",
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0e1530;">
        <div style="padding:24px 0 12px;font-size:15px;font-weight:700;">Bill Tracker</div>
        <h1 style="font-size:20px;margin:0 0 8px;">Email alerts are working</h1>
        <p style="font-size:14px;line-height:1.5;margin:0 0 14px;">You asked for this test at ${sentAt} Eastern. Bill changes, drug board news and team invitations will arrive from this same address: <strong>${process.env.RESEND_FROM_EMAIL!.replace(/</g, "&lt;")}</strong>.</p>
        <p style="font-size:13px;line-height:1.5;color:#5b6478;margin:0 0 20px;">If this landed in spam or promotions, mark it "Not spam" and add the address to your contacts so alerts reach your inbox.</p>
        ${appUrl ? `<a href="${appUrl}/settings#notifications" style="display:inline-block;background:#2b50f0;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-size:14px;font-weight:600;">Alert settings</a>` : ""}
      </div>`,
      text: `Email alerts are working. You asked for this test at ${sentAt} Eastern. Alerts will come from ${process.env.RESEND_FROM_EMAIL}. If it landed in spam, mark it "Not spam".`,
    });
    if (error) {
      console.error("test email failed", error);
      return NextResponse.json({ error: error.message ?? "Resend rejected the send" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("test email failed", err);
    return NextResponse.json({ error: err?.message ?? "Send failed" }, { status: 502 });
  }
}

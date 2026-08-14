import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";

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
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: user.email,
      subject: "Bill Tracker test email",
      html: `<div style="font-family: -apple-system, sans-serif; max-width: 480px;">
        <p style="font-weight: 600; color: #0f7a5c;">Bill Tracker</p>
        <p>This is a test email - if you're reading this, email notifications are working correctly.</p>
      </div>`,
      text: "This is a test email from Bill Tracker. If you're reading this, email notifications are working correctly.",
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

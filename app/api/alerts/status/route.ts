import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { smsConfigured } from "@/lib/sms";

export const dynamic = "force-dynamic";

// GET - which ways of reaching people this app has set up, so Settings can
// say "texts aren't set up yet" instead of offering a switch that does nothing.
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  return NextResponse.json({
    email: !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL,
    emailFrom: process.env.RESEND_FROM_EMAIL ?? null,
    sms: smsConfigured(),
  });
}

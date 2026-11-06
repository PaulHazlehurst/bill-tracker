import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { sendSms, smsConfigured, normalizePhone } from "@/lib/sms";

export const maxDuration = 30;

// POST - sends a test text to the signed-in person's own phone (from
// Settings). Like the test email, this is an explicit one-off request, so
// it doesn't depend on their per-bill text settings.
export async function POST() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  if (!smsConfigured()) {
    return NextResponse.json({ error: "Texts aren't set up for this app yet. An admin needs to connect a Twilio account (see Data sources)." }, { status: 503 });
  }
  const { data: profile } = await auth.supabase.from("profiles").select("phone").eq("id", auth.user.id).maybeSingle();
  const phone = normalizePhone(profile?.phone);
  if (!phone) return NextResponse.json({ error: "Add your mobile number in Settings first, then save." }, { status: 400 });
  try {
    await sendSms(phone, "Bill Tracker: this is a test text. If you got it, text alerts are working. Reply STOP to stop.");
    return NextResponse.json({ ok: true, to: `•••${phone.slice(-4)}` });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 502 });
  }
}

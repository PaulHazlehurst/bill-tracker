// SERVER-ONLY (except the pure helpers). Text messages through Twilio.
//
// Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and either TWILIO_FROM_NUMBER
// (a Twilio phone number) or TWILIO_MESSAGING_SERVICE_SID (a Messaging
// Service, which is what US 10DLC registration attaches to). Without them,
// texts are simply off.

export function smsConfigured(): boolean {
  return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!(process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID);
}

export { normalizePhone } from "@/lib/phone";
import { normalizePhone } from "@/lib/phone";

/** What a Twilio error code means for the person reading the message, and what to do. */
export function explainTwilioError(code: number | null | undefined, fallback: string): string {
  switch (code) {
    case 21608:
    case 21219:
      return "The Twilio account is still a free trial, which can only text numbers verified in Twilio. Verify this number in Twilio (Phone Numbers, Verified Caller IDs), or upgrade the account.";
    case 21610:
      return "This number replied STOP earlier, so carriers block texts to it. Text START to the app's number to opt back in.";
    case 21211:
    case 21614:
      return "That doesn't look like a mobile number that can receive texts. Check it in Settings.";
    case 21606:
    case 21659:
    case 21660:
      return "The sending number (TWILIO_FROM_NUMBER) isn't a Twilio number on this account, or can't send texts.";
    case 30034:
    case 30032:
      return "US carriers blocked this text because the sending number isn't registered yet (A2P 10DLC). Finish registration in Twilio's Trust Hub; it usually takes a few days.";
    case 20003:
      return "Twilio rejected the account details. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Vercel.";
    default:
      return fallback;
  }
}

function authHeader() {
  return `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

/** Sends one text. Throws an Error whose message is already plain English. */
export async function sendSms(to: string, body: string): Promise<{ sid: string; status: string }> {
  const number = normalizePhone(to);
  if (!number) throw new Error("That phone number isn't in a format that can be texted. Use a 10-digit US number, or +country code.");
  const params = new URLSearchParams({ To: number, Body: body.slice(0, 640) });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set("From", process.env.TWILIO_FROM_NUMBER!);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explainTwilioError(json.code, `Twilio couldn't send it (${json.message ?? res.status}).`));
  return { sid: json.sid, status: json.status };
}

/** Account type and sender, for the Data sources page. */
export async function twilioAccount(): Promise<{ ok: boolean; trial: boolean; status: string; detail?: string }> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}.json`, { headers: { Authorization: authHeader() } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, trial: false, status: "error", detail: explainTwilioError(json.code, `Twilio returned ${res.status}`) };
  return { ok: true, trial: json.type === "Trial", status: json.status };
}

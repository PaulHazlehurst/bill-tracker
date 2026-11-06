import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { createAdminClient } from "@/lib/supabase/server";
import { isPushEndpoint } from "@/lib/pushClient";

// POST { subscription, label } - this device should get push alerts.
// DELETE { endpoint } - stop sending to this device.
// Saved with the server key so a browser that changes hands (signed out,
// someone else signs in) moves to the new person instead of failing.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const sub = body.subscription ?? {};
  const endpoint = String(sub.endpoint ?? "");
  const p256dh = String(sub.keys?.p256dh ?? "");
  const authKey = String(sub.keys?.auth ?? "");
  if (!isPushEndpoint(endpoint) || !p256dh || !authKey) return NextResponse.json({ error: "That isn't a valid push subscription." }, { status: 400 });
  const label = typeof body.label === "string" ? body.label.slice(0, 80) : null;
  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .upsert({ user_id: auth.user.id, endpoint, p256dh, auth: authKey, device_label: label, failures: 0 }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  if (typeof body.endpoint !== "string") return NextResponse.json({ error: "missing endpoint" }, { status: 400 });
  await auth.supabase.from("push_subscriptions").delete().eq("endpoint", body.endpoint);
  return NextResponse.json({ ok: true });
}

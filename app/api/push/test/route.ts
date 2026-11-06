import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications";

export const maxDuration = 30;

// POST - sends a test notification to the signed-in person: into their bell
// and to every device they've turned push on for.
export async function POST() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const { count } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id);
  try {
    const r = await notify(admin, [{ userId: auth.user.id, kind: "test", title: "Test notification", body: "Push alerts are working on this device.", url: "/settings#notifications" }]);
    return NextResponse.json({ ok: true, devices: count ?? 0, delivered: r.pushed > 0 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}

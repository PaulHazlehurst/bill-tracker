import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// GET - genuinely public, no auth check. This is what a real one-click
// unsubscribe requires: someone must be able to click the link in an email
// without first logging in. The blast radius is intentionally small - the
// only thing this can ever do is turn OFF email notifications for the one
// account whose id is in the link. See lib/emailTemplate.ts for the full
// reasoning on why the profile id itself is safe to use here.
export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get("uid");
  const resubscribe = req.nextUrl.searchParams.get("resubscribe") === "true";
  if (!uid) return NextResponse.json({ error: "missing uid" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ email_notifications_enabled: !resubscribe }).eq("id", uid);

  if (error) {
    console.error("unsubscribe failed", error);
    return NextResponse.json({ error: "Couldn't process that - the link may be invalid." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

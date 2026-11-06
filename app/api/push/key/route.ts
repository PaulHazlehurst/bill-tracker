import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { createAdminClient } from "@/lib/supabase/server";
import { vapidKeys } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// GET - the public half of the app's push key, which browsers need to sign
// up a device for push alerts. (The private half never leaves the server.)
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  try {
    const { publicKey } = await vapidKeys(createAdminClient());
    return NextResponse.json({ publicKey });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 503 });
  }
}

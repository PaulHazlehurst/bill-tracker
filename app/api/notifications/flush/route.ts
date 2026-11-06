import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { createAdminClient } from "@/lib/supabase/server";
import { flushPending } from "@/lib/notifications";

export const maxDuration = 30;

// POST - pushes notifications created in the last few minutes that haven't
// been pushed yet. Called right after an action that notifies someone else
// through the database (assigning a task), so their phone buzzes now rather
// than at the next morning run. Only ever sends what's already queued.
export async function POST() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const pushed = await flushPending(createAdminClient(), { withinMinutes: 10 }).catch(() => 0);
  return NextResponse.json({ ok: true, pushed });
}

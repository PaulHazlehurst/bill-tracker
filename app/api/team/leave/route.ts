import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { createAdminClient } from "@/lib/supabase/server";
import { leaveTeam } from "@/lib/team";

// POST - leave your team. Your tracked bills stay yours. If you own the
// team, ownership passes to another admin (or the longest-standing member).
export async function POST() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  await leaveTeam(createAdminClient(), auth.user.id);
  return NextResponse.json({ ok: true });
}

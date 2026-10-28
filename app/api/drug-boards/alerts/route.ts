import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

// POST { enabled } - your own opt-in to the daily drug board email.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const b = await req.json().catch(() => ({}));
  const { error } = await auth.supabase.from("profiles").update({ drug_board_alerts: !!b.enabled }).eq("id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

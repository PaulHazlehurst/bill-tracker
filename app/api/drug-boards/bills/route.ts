import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

// PATCH { id, hidden } - "not relevant" (or bring it back).
export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== "string") return NextResponse.json({ error: "missing id" }, { status: 400 });
  const hidden = b.hidden !== false;
  const { error } = await auth.supabase.from("state_bills").update({ hidden, hidden_by: hidden ? auth.user.id : null }).eq("id", b.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

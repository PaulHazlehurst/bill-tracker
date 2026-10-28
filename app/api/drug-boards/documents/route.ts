import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

// PATCH { ids: string[], reviewed: boolean } - mark new documents as read (or unread).
export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string").slice(0, 200) : [];
  if (!ids.length) return NextResponse.json({ error: "nothing selected" }, { status: 400 });
  const patch = body.reviewed === false ? { reviewed_at: null, reviewed_by: null } : { reviewed_at: new Date().toISOString(), reviewed_by: auth.user.id };
  const { error } = await auth.supabase.from("board_documents").update(patch).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

// What can be marked as read on the Drug boards page.
const TABLES = {
  document: { table: "board_documents", by: true },
  change: { table: "board_page_changes", by: true },
  filing: { table: "board_case_filings", by: false },
} as const;

// PATCH { ids: string[], reviewed: boolean, type?: "document" | "change" | "filing" }
// - mark new documents, page wording changes or court filings as read (or unread).
export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string").slice(0, 200) : [];
  if (!ids.length) return NextResponse.json({ error: "nothing selected" }, { status: 400 });
  const target = TABLES[(body.type ?? "document") as keyof typeof TABLES];
  if (!target) return NextResponse.json({ error: "unknown type" }, { status: 400 });
  const reviewed = body.reviewed !== false;
  const patch: Record<string, string | null> = { reviewed_at: reviewed ? new Date().toISOString() : null };
  if (target.by) patch.reviewed_by = reviewed ? auth.user.id : null;
  const { error } = await auth.supabase.from(target.table).update(patch).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

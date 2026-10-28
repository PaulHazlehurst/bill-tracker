import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { isPublicWebUrl } from "@/lib/drugBoards";

// POST { state, url, label? } - watch another board page for new documents.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const b = await req.json().catch(() => ({}));
  const raw = String(b.url ?? "").trim();
  if (!isPublicWebUrl(raw)) return NextResponse.json({ error: "Paste the page's full public web address, starting with https://" }, { status: 400 });
  const url = new URL(raw);
  if (typeof b.state !== "string" || !/^[A-Z]{2}$/.test(b.state)) return NextResponse.json({ error: "Pick a state." }, { status: 400 });
  const { data, error } = await auth.supabase
    .from("board_pages")
    .insert({ state: b.state, url: url.toString(), label: typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 80) : null, created_by: auth.user.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "That page is already being watched." : error.message }, { status: error.code === "23505" ? 409 : 500 });
  return NextResponse.json({ id: data.id });
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const { error } = await auth.supabase.from("board_pages").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

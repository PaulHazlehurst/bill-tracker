import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

const KINDS = new Set(["meeting", "comment_deadline", "hearing", "other"]);

// POST { state, date, time?, kind, title, url? } - a board meeting or deadline.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const b = await req.json().catch(() => ({}));
  if (typeof b.state !== "string" || !/^[A-Z]{2}$/.test(b.state)) return NextResponse.json({ error: "Pick a state." }, { status: 400 });
  if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return NextResponse.json({ error: "Pick a date." }, { status: 400 });
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "Say what it is, like Board meeting." }, { status: 400 });
  const url = typeof b.url === "string" && /^https?:\/\//i.test(b.url.trim()) ? b.url.trim() : null;
  const { data, error } = await auth.supabase
    .from("board_dates")
    .insert({ state: b.state, date: b.date, time: typeof b.time === "string" && b.time.trim() ? b.time.trim().slice(0, 20) : null, kind: KINDS.has(b.kind) ? b.kind : "meeting", title, url, created_by: auth.user.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const { error } = await auth.supabase.from("board_dates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

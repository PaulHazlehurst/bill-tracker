import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET  - your private calendar link (created the first time you ask).
// POST { reset: true } - replaces it, so the old link stops working.
async function linkFor(origin: string, token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || origin;
  return `${base.replace(/\/$/, "")}/api/calendar/feed/${token}.ics`;
}

async function getOrCreate(supabase: any, userId: string) {
  const { data, error } = await supabase.from("calendar_feeds").select("token").eq("user_id", userId).maybeSingle();
  if (error) return { error: error.message };
  if (data?.token) return { token: data.token as string };
  const { data: created, error: insertError } = await supabase.from("calendar_feeds").insert({ user_id: userId }).select("token").single();
  if (insertError) return { error: insertError.message };
  return { token: created.token as string };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await getOrCreate(supabase, user.id);
  if ("error" in result) return NextResponse.json({ error: "Calendar links need the Week ahead database update (0002) first." }, { status: 500 });
  return NextResponse.json({ url: await linkFor(req.nextUrl.origin, result.token) });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.reset) await supabase.from("calendar_feeds").delete().eq("user_id", user.id);
  const result = await getOrCreate(supabase, user.id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ url: await linkFor(req.nextUrl.origin, result.token) });
}

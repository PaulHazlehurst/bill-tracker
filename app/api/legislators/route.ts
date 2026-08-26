import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchMembers } from "@/lib/congress-api";

// GET /api/legislators?q=texas
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? undefined;

  try {
    const members = await searchMembers(q);
    return NextResponse.json({ members });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, members: [] }, { status: 502 });
  }
}

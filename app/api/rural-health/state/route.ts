import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStateDetail, isConfigured } from "@/lib/ruralCareJourney-api";

// GET ?code=MD
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isConfigured()) {
    return NextResponse.json({ configured: false, state: null });
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });

  try {
    const state = await getStateDetail(code);
    return NextResponse.json({ configured: true, state });
  } catch (err) {
    console.error("rural health state fetch failed", err);
    return NextResponse.json({ configured: true, state: null });
  }
}

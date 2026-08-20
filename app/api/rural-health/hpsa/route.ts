import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHPSAByState } from "@/lib/ruralCareJourney-api";

export const revalidate = 86400; // once per day, matching HRSA's own refresh

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const code = req.nextUrl.searchParams.get("state");
  try {
    const all = await getHPSAByState();
    if (code) {
      const match = Object.values(all).find((s) =>
        s.state.toLowerCase() === code.toLowerCase() ||
        s.state.toLowerCase().replace(/\s+/g, "") === code.toLowerCase().replace(/\s+/g, "")
      );
      return NextResponse.json({ hpsa: match ?? null });
    }
    return NextResponse.json({ hpsa: all });
  } catch (err) {
    console.error("HPSA fetch failed", err);
    return NextResponse.json({ hpsa: null, error: "HRSA data temporarily unavailable" });
  }
}

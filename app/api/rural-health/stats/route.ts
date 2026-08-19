import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicStats } from "@/lib/ruralCareJourney-api";

// GET - no params. Uses Next's route-level revalidate so anonymous-ish
// internal traffic doesn't hammer a third-party free endpoint on every
// page load - refreshed at most once an hour.
export const revalidate = 3600;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const stats = await getPublicStats();
    return NextResponse.json({ stats });
  } catch (err) {
    console.error("rural health stats fetch failed", err);
    return NextResponse.json({ stats: null });
  }
}

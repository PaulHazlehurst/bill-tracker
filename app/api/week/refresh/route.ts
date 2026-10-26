import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { syncWeekAhead } from "@/lib/meetings";

// Fetching a backlog of meeting records can take a while the first time.
export const maxDuration = 60;

// POST - pulls the latest committee meetings and House floor schedule from
// congress.gov and docs.house.gov. The morning job does this daily; the page
// calls it when its copy is more than a few hours old. Safe to call often:
// only one sync runs at a time and unchanged records are skipped.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "The database admin key isn't set, so the schedule can't be saved." }, { status: 500 });

  try {
    const result = await syncWeekAhead(createAdminClient(), 45_000);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("week refresh failed", err);
    return NextResponse.json({ error: "Couldn't reach congress.gov just now." }, { status: 502 });
  }
}

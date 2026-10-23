import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchBillsRanked } from "@/lib/congress-api";

export const maxDuration = 30;

// GET ?q=... - keyword or citation search. Searches the full text of every
// bill in the current Congress (GovInfo) plus recently updated bill titles
// (congress.gov), ranked so bills that are clearly about the query come
// first. Each result says why it matched.
export async function GET(req: NextRequest) {
  // Require a signed-in session before spending API quota on a search.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) return NextResponse.json({ error: "Type at least two letters." }, { status: 400 });

  try {
    const { results, failed, passes } = await searchBillsRanked(q.trim(), { recentPages: 1, limit: 30 });
    const { data: tracked } = await supabase.from("tracked_bills").select("bill_id").eq("user_id", user.id);
    const mine = new Set((tracked ?? []).map((r) => r.bill_id));
    const bills = results.map((r) => ({ ...r, id: `${r.type.toLowerCase()}-${r.number}-${r.congress}`, tracked: mine.has(`${r.type.toLowerCase()}-${r.number}-${r.congress}`) }));
    return NextResponse.json({ bills, partial: failed.length > 0 && failed.length < passes });
  } catch (err) {
    console.error("bill search failed", err);
    return NextResponse.json({ error: "Search is unavailable right now. Try again in a minute." }, { status: 502 });
  }
}

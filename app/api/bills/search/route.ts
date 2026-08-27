import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchBillsSmart } from "@/lib/congress-api";

export async function GET(req: NextRequest) {
  // Require a signed-in session before spending congress.gov quota on a search.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ error: "query too short" }, { status: 400 });
  }

  try {
    const bills = await searchBillsSmart(q.trim());
    return NextResponse.json({ bills });
  } catch (err) {
    console.error("bill search failed", err);
    return NextResponse.json({ error: "search failed" }, { status: 502 });
  }
}

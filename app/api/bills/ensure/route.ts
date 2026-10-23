import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { buildNewBillRow, nextPollAt } from "@/lib/billRefresh";

export const maxDuration = 30;

// POST { billId: "hr-1234-119" } - makes sure a bill exists in our local
// cache so its page can open, even if nobody tracks it yet. This is what lets
// someone open a search result or suggestion and read it BEFORE deciding to
// track it.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { billId } = await req.json().catch(() => ({}));
  const m = typeof billId === "string" ? billId.match(/^(hr|s|hjres|sjres|hconres|sconres|hres|sres)-(\d{1,5})-(\d{2,3})$/) : null;
  if (!m) return NextResponse.json({ error: "That isn't a valid bill id." }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing } = await admin.from("bills").select("id").eq("id", billId).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, created: false });

  try {
    const row = await buildNewBillRow(Number(m[3]), m[1], Number(m[2]));
    row.next_poll_at = nextPollAt(String(row.status_stage), false);
    row.poll_priority = "dormant";
    const { error } = await admin.from("bills").insert(row);
    if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, created: true });
  } catch {
    return NextResponse.json({ error: "Couldn't find that bill on congress.gov." }, { status: 404 });
  }
}

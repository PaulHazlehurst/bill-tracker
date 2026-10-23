import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildNewBillRow } from "@/lib/billRefresh";

// Calls outside services; Vercel's short default limit can cut it off.
export const maxDuration = 30;

// POST { congress, billType, billNumber }
// Tracks a bill for the signed-in user. If they belong to an organization,
// the row is automatically visible on that org's team page too (see
// supabase/schema.sql RLS policies) - there's no separate "team mode" to pick,
// tracking a bill is inherently visible to your team.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { congress, billType, billNumber } = await req.json();
  if (!congress || !billType || !billNumber) {
    return NextResponse.json({ error: "missing bill identifier" }, { status: 400 });
  }

  const type = String(billType).toLowerCase();
  const number = parseInt(String(billNumber), 10);
  const congressNum = Number(congress);
  if (!Number.isFinite(number) || !Number.isFinite(congressNum)) {
    return NextResponse.json({ error: "That doesn't look like a valid bill number." }, { status: 400 });
  }
  const id = `${type}-${number}-${congressNum}`;

  // Only fetch from congress.gov if we don't already have this bill cached -
  // this keeps request volume tied to unique bills, not to trackers.
  const { data: existing } = await supabase.from("bills").select("id").eq("id", id).maybeSingle();

  if (!existing) {
    let row: Record<string, unknown>;
    try {
      row = await buildNewBillRow(congressNum, type, number);
    } catch (err) {
      console.error("congress.gov fetch failed", err);
      return NextResponse.json({ error: "Couldn't find that bill on congress.gov. Check the bill number and try again." }, { status: 502 });
    }

    // actions_cache / actions_fetched_at are optional extras - if an older
    // schema rejects them, save the bill without them.
    let { error: insertError } = await supabase.from("bills").insert(row);
    if (insertError && /actions_/.test(insertError.message)) {
      const { actions_cache, actions_fetched_at, ...rest } = row as any;
      ({ error: insertError } = await supabase.from("bills").insert(rest));
    }
    if (insertError && insertError.code !== "23505") {
      console.error("failed to save new bill", insertError);
      return NextResponse.json({ error: "Found the bill, but couldn't save it: " + insertError.message }, { status: 500 });
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, default_notify_email, default_notify_sms")
    .eq("id", user.id)
    .single();

  const { error } = await supabase.from("tracked_bills").insert({
    bill_id: id,
    user_id: user.id,
    organization_id: profile?.organization_id ?? null,
    notify_email: profile?.default_notify_email ?? true,
    notify_sms: profile?.default_notify_sms ?? false,
  });

  if (error) {
    if (error.code === "23505") return NextResponse.json({ ok: true, billId: id, alreadyTracked: true });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // If this bill had been a topic suggestion, it isn't one any more.
  await supabase.from("prospective_bills").update({ dismissed: true }).eq("bill_id", id);

  return NextResponse.json({ ok: true, billId: id });
}

// DELETE ?trackedBillId=...  (RLS ensures this only removes rows the user owns)
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const trackedBillId = req.nextUrl.searchParams.get("trackedBillId");
  if (!trackedBillId) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase.from("tracked_bills").delete().eq("id", trackedBillId).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

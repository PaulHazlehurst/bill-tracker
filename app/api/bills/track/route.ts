import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBill, inferStage, progressForStage } from "@/lib/congress-api";

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

  const id = `${String(billType).toLowerCase()}-${billNumber}-${congress}`;

  // Only fetch from congress.gov if we don't already have this bill cached -
  // this is what keeps request volume tied to unique bills, not to trackers.
  const { data: existing } = await supabase.from("bills").select("id").eq("id", id).maybeSingle();

  if (!existing) {
    let b: any;
    try {
      const raw = await getBill(congress, billType, billNumber);
      b = raw.bill;
    } catch (err) {
      console.error("congress.gov fetch failed", err);
      return NextResponse.json({ error: "Could not fetch that bill from congress.gov - check the bill number and try again." }, { status: 502 });
    }

    const latestActionText = b.latestAction?.text ?? "";
    const stage = inferStage(latestActionText);

    const { error: insertError } = await supabase.from("bills").insert({
      id,
      congress,
      bill_type: String(billType).toLowerCase(),
      bill_number: billNumber,
      title: b.title ?? `${String(billType).toUpperCase()} ${billNumber}`,
      latest_action: latestActionText || null,
      latest_action_date: b.latestAction?.actionDate ?? null,
      status_stage: stage,
      progress_pct: progressForStage(stage),
      congress_url: b.url ?? null,
      raw_snapshot: b,
      last_polled_at: new Date().toISOString(),
      next_poll_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      poll_priority: "normal",
    });

    if (insertError) {
      console.error("failed to save new bill", insertError);
      return NextResponse.json({ error: "Fetched the bill, but couldn't save it: " + insertError.message }, { status: 500 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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

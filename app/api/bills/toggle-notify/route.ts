import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST { billId, notifyEmail, notifySms }
// Updates the signed-in user's own tracked_bills row for this bill.
// RLS (auth.uid() = user_id) means this can never touch another user's row.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { billId, notifyEmail, notifySms } = await req.json();
  if (!billId) return NextResponse.json({ error: "missing billId" }, { status: 400 });

  const { error } = await supabase
    .from("tracked_bills")
    .update({ notify_email: notifyEmail, notify_sms: notifySms })
    .eq("bill_id", billId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

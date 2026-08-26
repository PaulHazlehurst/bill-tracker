import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMember, getMemberBills } from "@/lib/congress-api";

// GET /api/legislators/A000123 — single legislator detail + their bills
export async function GET(req: NextRequest, { params }: { params: { bioguideId: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { bioguideId } = params;

  try {
    const [member, sponsored, cosponsored] = await Promise.all([
      getMember(bioguideId),
      getMemberBills(bioguideId, "sponsored", 20),
      getMemberBills(bioguideId, "cosponsored", 20),
    ]);

    if (!member) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Cross-reference with user's tracked bills to highlight overlap
    const { data: tracked } = await supabase
      .from("tracked_bills")
      .select("bill_id")
      .eq("user_id", user.id);
    const trackedIds = new Set((tracked ?? []).map((r) => r.bill_id));

    const tagOverlap = (bills: typeof sponsored) =>
      bills.map((b) => ({
        ...b,
        billId: `${b.type.toLowerCase()}-${b.number}-${b.congress}`,
        isTracked: trackedIds.has(`${b.type.toLowerCase()}-${b.number}-${b.congress}`),
      }));

    return NextResponse.json({
      member,
      sponsored: tagOverlap(sponsored),
      cosponsored: tagOverlap(cosponsored),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

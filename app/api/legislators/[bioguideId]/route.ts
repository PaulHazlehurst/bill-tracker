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

    // Cross-reference with the user's tracked bills AND their positions, so
    // we can both highlight overlap and compute a "friend or foe" alignment
    // score - how often this member sponsors bills you support vs. bills you
    // oppose. That read is the whole reason to look a legislator up here
    // rather than on congress.gov.
    const { data: tracked } = await supabase
      .from("tracked_bills")
      .select("bill_id, position")
      .eq("user_id", user.id);
    const positionByBill = new Map<string, string>(
      (tracked ?? []).map((r) => [r.bill_id, r.position ?? "none"]),
    );

    const tagOverlap = (bills: typeof sponsored) =>
      bills.map((b) => {
        const billId = `${b.type.toLowerCase()}-${b.number}-${b.congress}`;
        return {
          ...b,
          billId,
          isTracked: positionByBill.has(billId),
          position: positionByBill.get(billId) ?? null,
        };
      });

    const sponsoredTagged = tagOverlap(sponsored);
    const cosponsoredTagged = tagOverlap(cosponsored);

    // Alignment: tally the positions you hold on every bill this member has
    // their name on. Supporting one of their bills = they're advancing your
    // cause; opposing one = friction.
    let aligned = 0;
    let atOdds = 0;
    let watching = 0;
    for (const b of [...sponsoredTagged, ...cosponsoredTagged]) {
      if (!b.isTracked) continue;
      if (b.position === "support") aligned++;
      else if (b.position === "oppose") atOdds++;
      else watching++;
    }
    let label = "No overlap yet";
    if (aligned > 0 && atOdds === 0) label = "Aligned with you";
    else if (atOdds > 0 && aligned === 0) label = "At odds with you";
    else if (aligned > 0 && atOdds > 0) label = "Mixed record";

    return NextResponse.json({
      member,
      sponsored: sponsoredTagged,
      cosponsored: cosponsoredTagged,
      alignment: { aligned, atOdds, watching, label },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

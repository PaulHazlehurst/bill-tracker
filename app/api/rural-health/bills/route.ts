import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchBillsSmart } from "@/lib/congress-api";

// GET /api/rural-health/bills?topic=<preset key>&q=<free text>
//
// The rural-health bill finder. The rest of the Rural Health page shows
// shortage and funding DATA; this is the part that connects that data to
// legislation you can actually act on - "45 shortage areas in Montana" is
// only useful if you can get from there to the bills that would change it.
//
// Searches run through searchBillsSmart (GovInfo full-text + congress.gov
// title match), the same engine behind topic discovery, so this finds bills
// by what's IN them, not just what's in the title.

// Curated searches for the issues a rural-health policy shop actually works
// on. Each preset is a set of queries because no single phrase catches a
// policy area - "telehealth" alone misses "remote patient monitoring," and
// so on. Results are merged and de-duplicated.
// NOT exported: Next.js only allows specific exports from a route file
// (GET/POST/dynamic/revalidate/...), and a stray named export fails the build.
const RURAL_TOPICS: Record<string, { label: string; queries: string[] }> = {
  "rural-hospitals": {
    label: "Rural hospitals",
    queries: ["rural hospital", "critical access hospital", "hospital closure rural"],
  },
  "telehealth": {
    label: "Telehealth",
    queries: ["telehealth", "telemedicine", "remote patient monitoring"],
  },
  "workforce": {
    label: "Workforce & shortages",
    queries: ["health professional shortage area", "rural physician workforce", "National Health Service Corps"],
  },
  "medicare-medicaid": {
    label: "Medicare & Medicaid",
    queries: ["rural Medicare reimbursement", "Medicaid rural health", "disproportionate share hospital"],
  },
  "maternal": {
    label: "Rural maternal health",
    queries: ["rural maternal health", "obstetric care rural", "maternity care shortage"],
  },
  "behavioral": {
    label: "Behavioral & opioid",
    queries: ["rural mental health", "rural substance use disorder", "opioid treatment rural"],
  },
  "ems": {
    label: "EMS & ambulance",
    queries: ["rural emergency medical services", "ground ambulance", "air ambulance rural"],
  },
  "broadband": {
    label: "Broadband for care",
    queries: ["rural broadband health", "telehealth infrastructure"],
  },
  "clinics": {
    label: "Clinics & health centers",
    queries: ["federally qualified health center", "rural health clinic", "community health center"],
  },
};

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const topic = req.nextUrl.searchParams.get("topic");
  const freeText = (req.nextUrl.searchParams.get("q") ?? "").trim();

  // Free text wins if provided; otherwise use the preset. A free-text search
  // is scoped with "rural health" context so a bare word like "ambulance"
  // returns rural-relevant results rather than everything in Congress.
  let queries: string[];
  if (freeText) {
    queries = [freeText, `rural ${freeText}`];
  } else if (topic && RURAL_TOPICS[topic]) {
    queries = RURAL_TOPICS[topic].queries;
  } else {
    queries = RURAL_TOPICS["rural-hospitals"].queries;
  }

  try {
    // Run the queries in parallel and merge. Each searchBillsSmart call is
    // itself two upstream requests, so this is deliberately capped at three
    // queries per preset to stay well inside the API budget.
    const settled = await Promise.allSettled(
      queries.slice(0, 3).map((q) => searchBillsSmart(q, 119, 1))
    );

    const anyOk = settled.some((s) => s.status === "fulfilled");
    if (!anyOk) {
      return NextResponse.json(
        { error: "Couldn't reach the bill search service right now.", bills: [] },
        { status: 502 }
      );
    }

    const seen = new Set<string>();
    const merged: {
      id: string; congress: number; billType: string; billNumber: string; title: string;
    }[] = [];
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      for (const b of s.value) {
        const id = `${b.type.toLowerCase()}-${b.number}-${b.congress}`;
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push({
          id,
          congress: b.congress,
          billType: b.type,
          billNumber: b.number,
          title: b.title,
        });
      }
    }

    // Rank substantive legislation above ceremonial resolutions. A firm
    // tracking rural health policy cares about HR/S bills far more than a
    // resolution "recognizing National Rural Health Day" - those were
    // crowding out the real results.
    const weight = (t: string) => {
      const k = t.toLowerCase();
      if (k === "hr" || k === "s") return 0;
      if (k === "hjres" || k === "sjres") return 1;
      return 2; // hres, sres, hconres, sconres - ceremonial/procedural
    };
    merged.sort((a, b) => weight(a.billType) - weight(b.billType));

    const bills = merged.slice(0, 40);

    // Mark which of these the user already tracks, so the UI can show
    // "Tracking" instead of offering to add it twice.
    const ids = bills.map((b) => b.id);
    let trackedIds: string[] = [];
    if (ids.length > 0) {
      const { data: tracked } = await supabase
        .from("tracked_bills")
        .select("bill_id")
        .eq("user_id", user.id)
        .in("bill_id", ids);
      trackedIds = (tracked ?? []).map((t) => t.bill_id);
    }

    return NextResponse.json({
      bills: bills.map((b) => ({ ...b, tracked: trackedIds.includes(b.id) })),
      partial: settled.some((s) => s.status === "rejected"),
    });
  } catch (err: any) {
    console.error("rural bill search failed", err);
    return NextResponse.json({ error: "Bill search failed.", bills: [] }, { status: 502 });
  }
}

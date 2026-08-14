import { NextResponse } from "next/server";

// Cached at the edge for an hour (Next.js route-level ISR) - this route has
// no auth check on purpose, since it's shown on the public landing page to
// anonymous visitors. Caching matters here specifically because anonymous
// traffic isn't bounded the way logged-in usage is; without this, a spike
// in landing-page visits could translate directly into congress.gov calls.
export const revalidate = 3600;

const CONGRESS = 119;

export async function GET() {
  try {
    const url = new URL(`https://api.congress.gov/v3/bill/${CONGRESS}`);
    url.searchParams.set("api_key", process.env.CONGRESS_API_KEY!);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`congress.gov fetch failed: ${res.status}`);
    const data = await res.json();

    return NextResponse.json({
      totalBills: data.pagination?.count ?? null,
      congress: CONGRESS,
    });
  } catch (err) {
    console.error("public stats fetch failed", err);
    // Fail quiet - the landing page has a static fallback if this is unavailable.
    return NextResponse.json({ totalBills: null, congress: CONGRESS });
  }
}

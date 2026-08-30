import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { searchNews } from "@/lib/newsFeed-api";

const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours - news moves faster than legislative data

// GET ?billId=&title=
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const billId = req.nextUrl.searchParams.get("billId");
  const title = req.nextUrl.searchParams.get("title");
  // Optional but genuinely useful: "H.R. 1234" as a matcher for the
  // curated-newsletter pass. Feed items that name the bill by its
  // formal citation always match, regardless of title overlap.
  const citation = req.nextUrl.searchParams.get("citation");
  if (!billId || !title) return NextResponse.json({ error: "missing billId or title" }, { status: 400 });

  const { data: cached } = await supabase
    .from("bills")
    .select("news_items, news_items_fetched_at")
    .eq("id", billId)
    .single();

  const isFresh = cached?.news_items_fetched_at &&
    Date.now() - new Date(cached.news_items_fetched_at).getTime() < STALE_AFTER_MS;

  if (isFresh) {
    return NextResponse.json({ items: cached?.news_items ?? [] });
  }

  try {
    // Query the bill's own title - specific enough to stay on-topic
    // without needing a separate keyword-list feature yet.
    const items = await searchNews(title, citation);
    const admin = createAdminClient();
    await admin.from("bills").update({
      news_items: items,
      news_items_fetched_at: new Date().toISOString(),
    }).eq("id", billId);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("news fetch failed", err);
    return NextResponse.json({ items: cached?.news_items ?? [] });
  }
}

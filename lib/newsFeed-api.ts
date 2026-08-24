// SERVER-ONLY. Google News RSS - the only free, no-key route left since
// Google deprecated its official News API in 2011 and never replaced it
// (confirmed via research). This is a public XML feed, not a formal API:
// no authentication, no guaranteed uptime SLA, and its own copyright
// notice restricts use to personal, non-commercial reading in a feed
// reader. For an internal team tool, showing real article LINKS (title,
// source, date) - never reproduced article text - is a reasonable use;
// this never stores or displays full article content, only pointers to it.

import { trackedFetch } from "@/lib/apiUsageTracker";

export type NewsItem = { title: string; source: string; url: string; publishedAt: string | null };

export async function searchNews(query: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await trackedFetch(url, { next: { revalidate: 3600 } } as RequestInit, "news_feed"); // hourly cache - a live news feed, not government data on a fixed schedule
  if (!res.ok) throw new Error(`Google News RSS fetch failed: ${res.status}`);
  const xml = await res.text();

  const items: NewsItem[] = [];
  const itemBlocks = xml.split("<item>").slice(1);

  for (const block of itemBlocks.slice(0, 8)) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);

    if (!titleMatch || !linkMatch) continue;

    items.push({
      title: decodeXmlEntities(titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "")),
      source: sourceMatch ? decodeXmlEntities(sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : "News",
      url: linkMatch[1].trim(),
      publishedAt: pubDateMatch ? pubDateMatch[1].trim() : null,
    });
  }

  return items;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

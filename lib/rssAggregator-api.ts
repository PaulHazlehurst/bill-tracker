// SERVER-ONLY. Direct RSS pull from a curated list of policy-focused
// outlets. Sits alongside Google News in the news pipeline, not instead of
// it - Google News covers breadth, these feeds cover the trade press a
// policy team actually reads.
//
// How the merge works:
//   1. Each feed is fetched with Next's edge cache (revalidate: 3600),
//      so ten users viewing ten different bills within an hour cost one
//      fetch per feed, not one per bill.
//   2. For a given bill title, we take feed items whose title or snippet
//      contains enough distinctive words from the bill.
//   3. Results are merged with Google News and passed through the same
//      dedup Stage 1 already ships.
//
// Adding a feed: append to FEEDS. That is the whole extension point.
// Removing one: same. A dead URL fails silently (Promise.allSettled) so
// one broken source can never take the whole page down.

import { trackedFetch } from "@/lib/apiUsageTracker";
import type { NewsItem, NewsTier } from "@/lib/newsFeed-api";

type FeedConfig = {
  name: string;    // display name that shows on each item
  url: string;     // public RSS/Atom URL
  tier: NewsTier;  // preclassified, skips the string-match tier heuristic
};

// URLs are the public RSS endpoints these publishers advertise. If one
// changes upstream we get zero items from that feed and every other feed
// keeps working (Promise.allSettled below). Any feed can be edited or
// removed here without touching anything else.
const FEEDS: FeedConfig[] = [
  { name: "Politico",       url: "https://rss.politico.com/politics-news.xml",           tier: "trade" },
  { name: "Politico Congress", url: "https://rss.politico.com/congress.xml",              tier: "trade" },
  { name: "The Hill",       url: "https://thehill.com/homenews/senate/feed/",            tier: "trade" },
  { name: "Roll Call",      url: "https://www.rollcall.com/feed/",                       tier: "trade" },
  { name: "Axios Politics", url: "https://api.axios.com/feed/politics-policy",           tier: "trade" },
  { name: "STAT News",      url: "https://www.statnews.com/feed/",                       tier: "trade" },
  { name: "Federal News Network", url: "https://federalnewsnetwork.com/feed/",           tier: "trade" },
];

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function parsePubDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function fetchFeed(config: FeedConfig): Promise<NewsItem[]> {
  const res = await trackedFetch(config.url, { next: { revalidate: 3600 } } as RequestInit, "rss_feed");
  if (!res.ok) throw new Error(`${config.name} feed fetch failed: ${res.status}`);
  const xml = await res.text();

  const items: NewsItem[] = [];
  // Handle both RSS <item> and Atom <entry>.
  const isAtom = xml.includes("<entry") && !xml.includes("<item");
  const blocks = xml.split(isAtom ? "<entry" : "<item").slice(1);

  for (const raw of blocks.slice(0, 40)) {
    const block = raw.slice(0, raw.indexOf(isAtom ? "</entry>" : "</item>"));
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    // Atom: <link href="..."/>. RSS: <link>...</link>.
    const linkMatch = isAtom
      ? block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/)
      : block.match(/<link[^>]*>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/);
    const descriptionMatch = block.match(/<(?:description|summary|content[^>]*)>([\s\S]*?)<\/(?:description|summary|content)>/);

    if (!titleMatch || !linkMatch) continue;

    const rawTitle = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "");
    const rawDesc = descriptionMatch ? descriptionMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "") : "";
    const cleanDesc = stripHtml(rawDesc);
    const snippet = cleanDesc.length > 180 ? cleanDesc.slice(0, 177).trimEnd() + "…" : cleanDesc;

    items.push({
      title: decodeXmlEntities(stripHtml(rawTitle)),
      source: config.name,
      url: linkMatch[1].trim(),
      publisherUrl: linkMatch[1].trim(), // RSS <link> already points at the publisher directly
      publishedAt: parsePubDate(pubDateMatch ? pubDateMatch[1].trim() : null),
      snippet: snippet || null,
      tier: config.tier,
    });
  }
  return items;
}

// Match a feed item against a bill query. We want to be strict: an item
// only counts if it contains a strong signal (several distinctive words
// from the bill title, or an explicit bill citation like "H.R. 1234").
// The alternative - loose matching - floods the panel with irrelevant
// politics-news items every time a feed happens to say "bill" or "health".
function matches(item: NewsItem, distinctiveWords: string[], billCitation: string | null): boolean {
  const hay = (item.title + " " + (item.snippet ?? "")).toLowerCase();
  if (billCitation && hay.includes(billCitation.toLowerCase())) return true;
  if (distinctiveWords.length === 0) return false;
  const hits = distinctiveWords.filter((w) => hay.includes(w)).length;
  return hits >= Math.max(2, Math.ceil(distinctiveWords.length * 0.5));
}

// Common English words to ignore when building the "distinctive words" list.
const STOP = new Set([
  "the","a","an","and","of","to","in","on","for","with","by","as","is","are","was","were",
  "from","at","that","this","act","bill","law","new","use","its","or","be","if",
]);

export async function searchNewsletters(
  billTitle: string,
  billCitation: string | null
): Promise<NewsItem[]> {
  const distinctiveWords = billTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOP.has(w));

  // No distinctive words to match on and no citation - nothing usable here.
  // Fall through to Google News rather than returning irrelevant items.
  if (distinctiveWords.length === 0 && !billCitation) return [];

  const settled = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));
  const all: NewsItem[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const item of s.value) {
      if (matches(item, distinctiveWords, billCitation)) all.push(item);
    }
  }
  return all;
}

// SERVER-ONLY. Google News RSS - the only free, no-key route left since
// Google deprecated its official News API in 2011 and never replaced it.
// This is a public XML feed, not a formal API: no authentication, no
// guaranteed uptime SLA, and its own copyright notice restricts use to
// personal, non-commercial reading in a feed reader. For an internal team
// tool, showing real article LINKS (title, source, date) - never
// reproduced article text - is a reasonable use; this never stores or
// displays full article content, only pointers to it plus the short
// snippet the feed itself provides.

import { trackedFetch } from "@/lib/apiUsageTracker";

export type NewsItem = {
  title: string;
  source: string;
  url: string;
  publisherUrl: string | null;   // real publisher URL if we can extract it, else null
  publishedAt: string | null;    // ISO 8601, if parseable
  snippet: string | null;        // short excerpt from the feed's own description
  tier: NewsTier;
};

export type NewsTier = "wire" | "mainstream" | "trade" | "local" | "other";

// A short curated list. The point isn't exhaustive coverage of every
// outlet; it's letting a reader filter "just wire stories" or "just trade
// press" on a busy news day. Names are normalised at match time so
// "The New York Times" and "New York Times" both match.
const WIRE = new Set([
  "associated press", "ap", "ap news", "reuters", "afp", "agence france-presse",
  "bloomberg", "dow jones",
]);
const MAINSTREAM = new Set([
  "new york times", "washington post", "wall street journal", "wsj",
  "cnn", "nbc news", "abc news", "cbs news", "fox news", "usa today",
  "npr", "pbs newshour", "atlantic", "guardian",
  "time", "newsweek", "economist", "financial times", "ft",
  "los angeles times", "chicago tribune", "boston globe",
]);
const TRADE = new Set([
  "politico", "politico pro", "roll call", "hill", "punchbowl news",
  "axios", "axios pro", "national journal", "cq roll call", "cq",
  "modern healthcare", "healthcare dive", "stat news", "stat", "kaiser health news", "khn",
  "fiercehealthcare", "healthcare finance news", "beckers hospital review",
  "inside health policy", "bloomberg government", "bgov",
  "e&e news", "eenews", "law360", "reuters health", "medscape",
]);

function normaliseSource(src: string): string {
  return src.toLowerCase().replace(/^the\s+/, "").replace(/[.,]/g, "").trim();
}

function classifyTier(source: string): NewsTier {
  const s = normaliseSource(source);
  if (WIRE.has(s)) return "wire";
  if (MAINSTREAM.has(s)) return "mainstream";
  if (TRADE.has(s)) return "trade";
  // Heuristic: outlets whose name ends with a paper-style word are
  // most likely local when not already in the mainstream set.
  if (/\b(gazette|tribune|herald|dispatch|register|chronicle|observer|beacon|sentinel|record|bulletin|post|star|times|news)\b/i.test(source)) return "local";
  return "other";
}

// Google News wraps every link in its own redirector. The article's real
// URL is often present as an <a href="..."> inside the <description>. If
// we can find it we use it: the browser skips the redirect chain, and the
// favicon lookup gets the right domain.
function extractPublisherUrl(description: string): string | null {
  const m = description.match(/<a\s+href="(https?:\/\/[^"]+)"/i);
  if (!m) return null;
  const u = m[1];
  if (u.includes("news.google.com")) return null;
  return u;
}

// Google's <description> is an HTML fragment; we want the visible text
// only, capped short. Never full articles - a snippet, not hosted content.
function extractSnippet(description: string): string | null {
  const text = description
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const capped = text.length > 180 ? text.slice(0, 177).trimEnd() + "…" : text;
  return capped;
}

function parsePubDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

// Normalise a headline to a rough key so "Senate passes rural care bill"
// and "Senate Passes Rural Care Bill" collapse to one story. Drops
// punctuation, wire-source prefixes ("AP: ..."), and common stopwords.
// Two stories whose keys overlap heavily are treated as the same story.
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/^[a-z\s]+:\s*/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|and|of|to|in|on|for|with|by|as|is|are|was|were|from|at)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Light-touch clustering: items whose title-keys share a large fraction of
// meaningful tokens collapse to one, and we keep the newest / highest-tier
// representative of each cluster.
//
// Uses Jaccard similarity (intersection / union) rather than shared / smaller.
// The looser metric was collapsing distinct stories that merely shared the
// bill's subject nouns ("rural health bill") - an AP wire story and an NYT
// opinion piece three days later would end up in the same cluster and the
// AP would silently get dropped. Jaccard requires actual overlap, not just
// subject overlap.
function dedupe(items: NewsItem[]): NewsItem[] {
  const clusters: NewsItem[][] = [];
  const tierRank: Record<NewsTier, number> = { wire: 0, mainstream: 1, trade: 2, local: 3, other: 4 };

  for (const item of items) {
    const key = titleKey(item.title);
    const tokens = new Set(key.split(" ").filter((t) => t.length > 3));
    let placed = false;
    for (const cluster of clusters) {
      const other = new Set(titleKey(cluster[0].title).split(" ").filter((t) => t.length > 3));
      let shared = 0;
      tokens.forEach((t) => { if (other.has(t)) shared++; });
      const union = tokens.size + other.size - shared;
      const jaccard = union === 0 ? 0 : shared / union;
      if (jaccard >= 0.6) {
        cluster.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([item]);
  }

  return clusters.map((cluster) => {
    cluster.sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      if (tb !== ta) return tb - ta;
      return tierRank[a.tier] - tierRank[b.tier];
    });
    return cluster[0];
  });
}

export async function searchNews(query: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  // Hourly cache at the fetch layer, on top of the 6h database cache the
  // API route applies. Two independent layers, both cheap.
  const res = await trackedFetch(url, { next: { revalidate: 3600 } } as RequestInit, "news_feed");
  if (!res.ok) throw new Error(`Google News RSS fetch failed: ${res.status}`);
  const xml = await res.text();

  const items: NewsItem[] = [];
  const itemBlocks = xml.split("<item>").slice(1);

  // Take up to 25 raw items so dedup has something to work with; final
  // returned count lands around 12-15 typical.
  for (const block of itemBlocks.slice(0, 25)) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const descriptionMatch = block.match(/<description>([\s\S]*?)<\/description>/);

    if (!titleMatch || !linkMatch) continue;

    const source = sourceMatch
      ? decodeXmlEntities(sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, ""))
      : "News";
    const description = descriptionMatch
      ? decodeXmlEntities(descriptionMatch[1].replace(/<!\[CDATA\[|\]\]>/g, ""))
      : "";

    items.push({
      title: decodeXmlEntities(titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "")),
      source,
      url: linkMatch[1].trim(),
      publisherUrl: description ? extractPublisherUrl(description) : null,
      publishedAt: parsePubDate(pubDateMatch ? pubDateMatch[1].trim() : null),
      snippet: description ? extractSnippet(description) : null,
      tier: classifyTier(source),
    });
  }

  return dedupe(items).slice(0, 15);
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

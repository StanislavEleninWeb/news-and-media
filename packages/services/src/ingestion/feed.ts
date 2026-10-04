import Parser from 'rss-parser';

export interface FeedItem {
  title: string;
  link: string;
  publishedAt: Date | null;
  author: string | null;
  /** Full or partial HTML/text content shipped in the feed, if any. */
  content: string | null;
  imageUrl: string | null;
}

type CustomItem = {
  'content:encoded'?: string;
  'media:content'?:
    { $?: { url?: string; medium?: string; type?: string } } | { $?: { url?: string } }[];
  'media:thumbnail'?: { $?: { url?: string } };
  creator?: string;
};

const parser = new Parser<Record<string, unknown>, CustomItem>({
  customFields: {
    item: ['content:encoded', 'media:content', 'media:thumbnail', 'creator'],
  },
});

function mediaUrl(item: Parser.Item & CustomItem): string | null {
  if (item.enclosure?.url && (item.enclosure.type ?? 'image/').startsWith('image/')) {
    return item.enclosure.url;
  }
  const media = item['media:content'];
  const first = Array.isArray(media) ? media[0] : media;
  if (first?.$?.url) return first.$.url;
  return item['media:thumbnail']?.$?.url ?? null;
}

/** Parses RSS 2.0, RSS 1.0 and Atom feeds into a uniform item list. */
export async function parseFeed(xml: string, baseUrl: string): Promise<FeedItem[]> {
  const feed = await parser.parseString(xml);
  const items: FeedItem[] = [];
  for (const item of feed.items) {
    const link = item.link?.trim();
    const title = item.title?.trim();
    if (!link || !title) continue;
    let absolute: string;
    try {
      absolute = new URL(link, baseUrl).toString();
    } catch {
      continue;
    }
    const date = item.isoDate ?? item.pubDate;
    const parsed = date ? new Date(date) : null;
    items.push({
      title,
      link: absolute,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      author: item.creator ?? (item as { author?: string }).author ?? null,
      content: item['content:encoded'] ?? item.content ?? null,
      imageUrl: mediaUrl(item),
    });
  }
  return items;
}

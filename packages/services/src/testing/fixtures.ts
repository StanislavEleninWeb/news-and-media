/** Shared HTML/RSS fixtures for ingestion tests. */

const paragraphsBg = [
  'Народното събрание прие на първо четене промените в закона за местните данъци и такси след продължителен дебат в пленарна зала.',
  'Според вносителите промените ще позволят на общините да планират по-добре приходите си и да намалят административната тежест за гражданите.',
  'Опозицията възрази, че текстовете са внесени без достатъчно обществено обсъждане, и поиска да бъдат отложени за следващата сесия.',
  'Финансовото министерство очаква ефектът върху бюджета да бъде неутрален, тъй като по-ниските ставки ще бъдат компенсирани от по-добрата събираемост.',
];

export function articleHtml(options: {
  title: string;
  paragraphs?: string[];
  image?: string;
  lang?: string;
  published?: string;
}): string {
  const paragraphs = options.paragraphs ?? paragraphsBg;
  return `<!doctype html>
<html lang="${options.lang ?? 'bg'}">
<head>
  <meta charset="utf-8">
  <title>${options.title} | Примерен вестник</title>
  ${options.image ? `<meta property="og:image" content="${options.image}">` : ''}
  ${options.published ? `<meta property="article:published_time" content="${options.published}">` : ''}
</head>
<body>
  <header><nav><a href="/">Начало</a> <a href="/politika">Политика</a> <a href="/sport">Спорт</a></nav></header>
  <aside class="sidebar"><h3>Най-четени</h3><ul><li><a href="/x">Друга новина</a></li></ul></aside>
  <main>
    <article>
      <h1>${options.title}</h1>
      <p class="byline">Автор: Иван Петров</p>
      ${paragraphs.map((p) => `<p>${p}</p>`).join('\n      ')}
    </article>
  </main>
  <footer>© Примерен вестник. Всички права запазени. <a href="/terms">Условия</a></footer>
</body>
</html>`;
}

export function rssFeed(
  items: { title: string; link: string; date?: string; description?: string; image?: string }[],
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Примерен вестник</title>
  <link>https://example.bg</link>
  <description>Новини</description>
  ${items
    .map(
      (item) => `<item>
    <title>${item.title}</title>
    <link>${item.link}</link>
    ${item.date ? `<pubDate>${item.date}</pubDate>` : ''}
    ${item.description ? `<description><![CDATA[${item.description}]]></description>` : ''}
    ${item.image ? `<media:content url="${item.image}" medium="image" />` : ''}
    <dc:creator>Редакция</dc:creator>
  </item>`,
    )
    .join('\n  ')}
</channel>
</rss>`;
}

export const longBgParagraphs = paragraphsBg;

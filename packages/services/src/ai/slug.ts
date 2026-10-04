// Bulgarian streamlined transliteration (official system, 2009).
const map: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sht',
  ъ: 'a',
  ь: 'y',
  ю: 'yu',
  я: 'ya',
};

/** URL slug from a title in Bulgarian or English. */
export function slugify(title: string, maxLength = 80): string {
  const transliterated = [...title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')]
    .map((ch) => map[ch] ?? ch)
    .join('');
  const slug = transliterated.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= maxLength) return slug || 'article';
  return slug.slice(0, maxLength).replace(/-[^-]*$/, '') || slug.slice(0, maxLength);
}

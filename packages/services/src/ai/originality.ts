/**
 * Measures how much of a rewrite is copied from its source: the share of the
 * rewrite's 8-word sequences that also appear in the source. Near-verbatim
 * copies score close to 1; genuine rewrites of the same facts score near 0.
 */
const SHINGLE = 8;

function words(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

function shingles(tokens: string[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i + SHINGLE <= tokens.length; i += 1)
    result.add(tokens.slice(i, i + SHINGLE).join(' '));
  return result;
}

export function copiedShare(rewrite: string, source: string): number {
  const rewriteShingles = shingles(words(rewrite));
  if (rewriteShingles.size === 0) return 0;
  const sourceShingles = shingles(words(source));
  let shared = 0;
  for (const shingle of rewriteShingles) if (sourceShingles.has(shingle)) shared += 1;
  return shared / rewriteShingles.size;
}

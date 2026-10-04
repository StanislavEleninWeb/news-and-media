import type { Locale } from '@nm/db/schema';

const targets: Record<Locale, string> = { bg: 'BG', en: 'EN-GB' };

/** DeepL translation, used for flagship articles when DEEPL_API_KEY is set. */
export async function deeplTranslate(
  options: { apiKey: string; apiUrl: string },
  input: { title: string; tldr: string; body: string },
  target: Locale,
  source?: Locale,
): Promise<{ title: string; tldr: string; body: string; characters: number }> {
  const params = new URLSearchParams();
  for (const text of [input.title, input.tldr, input.body]) params.append('text', text);
  params.set('target_lang', targets[target]);
  if (source) params.set('source_lang', source.toUpperCase());
  params.set('preserve_formatting', '1');
  const response = await fetch(`${options.apiUrl.replace(/\/$/, '')}/translate`, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${options.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`DeepL HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as { translations?: { text: string }[] };
  const [title, tldr, body] = (data.translations ?? []).map((t) => t.text);
  if (!title || !tldr || !body) throw new Error('DeepL returned an incomplete translation');
  return {
    title,
    tldr,
    body,
    characters: input.title.length + input.tldr.length + input.body.length,
  };
}

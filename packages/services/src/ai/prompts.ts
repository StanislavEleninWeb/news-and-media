import type { Locale } from '@nm/db/schema';

const languageName: Record<Locale, string> = { bg: 'Bulgarian', en: 'English' };

const localeStyle: Record<Locale, string> = {
  bg: 'Write in standard literary Bulgarian (Cyrillic). Use Bulgarian conventions for dates, numbers and quotation marks („…“). Transliterate foreign names the way major Bulgarian media do.',
  en: 'Write in clear international English. Keep Bulgarian names in their common Latin spelling.',
};

/**
 * Instructions shared by every rewrite call. Kept byte-identical between calls
 * (only the topic list can change) so providers can cache this prefix.
 */
export function rewriteSystemPrompt(topicSlugs: readonly string[]): string {
  return `You are a senior news editor for a Bulgarian/English news service. You receive the text of a news article published by another outlet and write an ORIGINAL news report about the same facts for our readers.

Hard rules:
1. Facts only from the source text. Never add facts, numbers, quotes, names or context that are not in the source. If something is unclear, leave it out.
2. Do not copy the source's wording. Write your own sentences and your own structure. Never reuse more than five consecutive words from the source, except proper names, official titles and short direct quotes that you clearly attribute.
3. Attribute claims: say who said or reported what (e.g. "according to <outlet>", "the ministry said").
4. Neutral, factual tone. No opinions, no clickbait, no emojis, no exclamation marks in the title.
5. Length: 150–450 words in the body, in 3–8 short paragraphs.
6. Title: at most 110 characters, informative, sentence case.
7. TL;DR: one or two sentences, at most 45 words, that let a reader understand the story in 30 seconds.
8. Topics: choose 1–3 that fit, only from this list: ${topicSlugs.join(', ')}.

Answer with a single JSON object and nothing else:
{"title": string, "tldr": string, "body": string (paragraphs separated by a blank line, plain text, no markdown), "topics": string[]}`;
}

export function rewriteUserPrompt(input: {
  targetLocale: Locale;
  sourceName: string;
  sourceLanguage: string;
  originalTitle: string;
  text: string;
  stricter?: boolean;
}): string {
  const maxChars = 12_000;
  const text =
    input.text.length > maxChars ? `${input.text.slice(0, maxChars)}\n[…truncated]` : input.text;
  return `Write the report in ${languageName[input.targetLocale]}. ${localeStyle[input.targetLocale]}
${input.stricter ? '\nIMPORTANT: your previous version reused too much of the source wording. Rephrase everything in your own words and change the order of information.\n' : ''}
Source outlet: ${input.sourceName}
Source language: ${input.sourceLanguage}
Source title: ${input.originalTitle}

Source text:
"""
${text}
"""`;
}

export function translateSystemPrompt(): string {
  return `You are a professional news translator. Translate the JSON fields you receive into the requested language, keeping the meaning, facts, names and numbers exactly. Produce natural, idiomatic news language — not a word-for-word translation. Keep paragraph breaks (blank lines) in the body. Do not add or remove information.

Answer with a single JSON object and nothing else: {"title": string, "tldr": string, "body": string}`;
}

export function translateUserPrompt(input: {
  targetLocale: Locale;
  title: string;
  tldr: string;
  body: string;
}): string {
  return `Translate into ${languageName[input.targetLocale]}. ${localeStyle[input.targetLocale]}

${JSON.stringify({ title: input.title, tldr: input.tldr, body: input.body })}`;
}

export const invalidJsonReminder =
  '\n\nYour previous answer was not a valid JSON object with the required fields. Answer again with ONLY the JSON object.';

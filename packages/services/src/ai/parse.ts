import { z } from 'zod';

export const rewriteSchema = z.object({
  title: z.string().trim().min(5).max(200),
  tldr: z.string().trim().min(10).max(600),
  body: z.string().trim().min(200),
  topics: z.array(z.string().trim().toLowerCase()).max(5).default([]),
});
export type RewriteOutput = z.infer<typeof rewriteSchema>;

export const translationSchema = rewriteSchema.omit({ topics: true });
export type TranslationOutput = z.infer<typeof translationSchema>;

/** Finds the JSON object in a model answer (tolerates code fences and stray text). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(candidate.slice(start, end + 1));
}

export function parseModelJson<T>(text: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const result = schema.safeParse(extractJson(text));
  if (!result.success) {
    throw new Error(
      `Model output failed validation: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return result.data;
}

/** Normalises body text: plain paragraphs separated by exactly one blank line. */
export function normaliseBody(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/\s*\n\s*/g, ' ')
        .replace(/^#+\s*/, '')
        .trim(),
    )
    .filter(Boolean)
    .join('\n\n');
}

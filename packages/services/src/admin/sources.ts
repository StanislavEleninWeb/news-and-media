import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@nm/db';
import { articles, sources } from '@nm/db/schema';
import { AdminError } from './articles';

export const sourceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(['rss', 'html']),
    url: z.string().trim().url().max(2000),
    homepageUrl: z
      .string()
      .trim()
      .url()
      .max(2000)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    language: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2}$/, 'two-letter language code'),
    defaultTopicId: z
      .string()
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    isActive: z.boolean(),
    fetchIntervalMinutes: z.coerce
      .number()
      .int()
      .min(10)
      .max(24 * 60),
    maxItemsPerFetch: z.coerce.number().int().min(1).max(100),
    linkSelector: z
      .string()
      .trim()
      .max(300)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    imagesAllowed: z.boolean(),
    credibilityRating: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    credibilityNote: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .refine((s) => s.kind !== 'html' || !!s.linkSelector, {
    message: 'HTML sources need a link selector',
    path: ['linkSelector'],
  })
  .refine((s) => /^https?:\/\//.test(s.url), { message: 'Only http(s) URLs', path: ['url'] });
export type SourceInput = z.infer<typeof sourceInputSchema>;

const toRow = (input: SourceInput) => ({
  name: input.name,
  kind: input.kind,
  url: input.url,
  homepageUrl: input.homepageUrl ?? null,
  language: input.language,
  defaultTopicId: input.defaultTopicId ?? null,
  isActive: input.isActive,
  fetchIntervalMinutes: input.fetchIntervalMinutes,
  maxItemsPerFetch: input.maxItemsPerFetch,
  linkSelector: input.linkSelector ?? null,
  imagesAllowed: input.imagesAllowed,
  credibilityRating: input.credibilityRating ?? null,
  credibilityNote: input.credibilityNote ?? null,
});

export async function listSourcesForAdmin(db: Db) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  return db
    .select({
      source: sources,
      articlesLast7Days: sql<number>`(select count(*)::int from ${articles} where ${articles.sourceId} = ${sources.id} and ${articles.ingestedAt} > ${weekAgo.toISOString()}::timestamptz)`,
    })
    .from(sources)
    .orderBy(asc(sources.name));
}

export async function createSource(db: Db, input: SourceInput) {
  const [row] = await db.insert(sources).values(toRow(input)).returning();
  return row!;
}

/** Saving resets the schedule so a changed or re-activated source is fetched on the next tick. */
export async function updateSource(db: Db, id: string, input: SourceInput) {
  const [row] = await db
    .update(sources)
    .set({ ...toRow(input), nextFetchAt: new Date(), consecutiveFailures: 0 })
    .where(eq(sources.id, id))
    .returning();
  if (!row) throw new AdminError('not_found');
  return row;
}

/** Sources with articles are deactivated instead of deleted (articles keep their attribution). */
export async function deleteOrDeactivateSource(
  db: Db,
  id: string,
): Promise<'deleted' | 'deactivated'> {
  const [usage] = await db.select({ n: count() }).from(articles).where(eq(articles.sourceId, id));
  if ((usage?.n ?? 0) > 0) {
    await db.update(sources).set({ isActive: false }).where(eq(sources.id, id));
    return 'deactivated';
  }
  await db.delete(sources).where(eq(sources.id, id));
  return 'deleted';
}

export async function failingSourceCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(sources)
    .where(and(eq(sources.isActive, true), gt(sources.consecutiveFailures, 0)));
  return row?.n ?? 0;
}

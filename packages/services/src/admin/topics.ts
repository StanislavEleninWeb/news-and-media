import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@nm/db';
import { topics } from '@nm/db/schema';

export const topicInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, 'lowercase letters, digits and dashes'),
  nameBg: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(60),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
  isActive: z.boolean(),
});
export type TopicInput = z.infer<typeof topicInputSchema>;

export const listAllTopics = (db: Db) =>
  db.select().from(topics).orderBy(asc(topics.sortOrder), asc(topics.slug));

export async function createTopic(db: Db, input: TopicInput) {
  const [row] = await db.insert(topics).values(input).returning();
  return row!;
}

/** The slug is part of public URLs and of AI classification, so it cannot be renamed. */
export async function updateTopic(db: Db, id: string, input: Omit<TopicInput, 'slug'>) {
  await db.update(topics).set(input).where(eq(topics.id, id));
}

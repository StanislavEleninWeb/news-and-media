import { asc, eq } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { topics, type Locale } from '@nm/db/schema';

export async function listTopics(db: Db, locale: Locale) {
  const rows = await db
    .select()
    .from(topics)
    .where(eq(topics.isActive, true))
    .orderBy(asc(topics.sortOrder), asc(topics.slug));
  return rows.map((t) => ({ id: t.id, slug: t.slug, name: locale === 'bg' ? t.nameBg : t.nameEn }));
}

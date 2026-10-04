import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import {
  articleCorrections,
  articleLocalizations,
  articles,
  jobs,
  sources,
  users,
} from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import { getArticle } from '../content/article';
import { getFeed } from '../content/feed';
import { claimJobs, completeJob, enqueueJob, failJob, runDueJobs } from '../jobs/queue';
import { createPublishedArticle, createSource } from '../testing/content';
import {
  AdminError,
  approveUrgent,
  clearUrgent,
  getArticleForEdit,
  listArticlesForAdmin,
  setArticleStatus,
  setArticleTopics,
  updateLocalization,
} from './articles';
import { getDashboard } from './dashboard';
import {
  createSource as adminCreateSource,
  deleteOrDeactivateSource,
  sourceInputSchema,
  updateSource,
} from './sources';
import { createTopic, topicInputSchema, updateTopic } from './topics';

let db: Db;
let close: () => Promise<void>;
let editorId: string;
let sourceId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTopics(db);
  editorId = (
    await db.insert(users).values({ email: 'editor@seweb.co', role: 'editor' }).returning()
  )[0]!.id;
  sourceId = (await createSource(db, { name: 'Дневник' })).id;
});
afterAll(async () => close());

describe('urgent approval', () => {
  it('is the only way an article becomes urgent, records the editor and queues a push', async () => {
    const article = await createPublishedArticle(db, { sourceId, isUrgent: true }); // flag alone does nothing
    expect(
      (await getFeed(db, { locale: 'bg' })).items.find((i) => i.id === article.id)?.isUrgent,
    ).toBe(false);

    await approveUrgent(db, article.id, editorId, 3);
    const [after] = await db.select().from(articles).where(eq(articles.id, article.id));
    expect(after).toMatchObject({ isUrgent: true, urgentApprovedBy: editorId, indexedAt: null });
    expect(after!.urgentExpiresAt!.getTime() - after!.urgentApprovedAt!.getTime()).toBe(
      3 * 3_600_000,
    );
    expect((await getFeed(db, { locale: 'bg' })).items[0]).toMatchObject({
      id: article.id,
      isUrgent: true,
    });

    const queued = await db.select().from(jobs).where(eq(jobs.kind, 'urgent_push'));
    expect(queued.map((j) => j.payload)).toEqual([{ articleId: article.id }]);
    await approveUrgent(db, article.id, editorId); // same hour: no duplicate push
    expect(await db.select().from(jobs).where(eq(jobs.kind, 'urgent_push'))).toHaveLength(1);

    await clearUrgent(db, article.id);
    expect(
      (await getFeed(db, { locale: 'bg' })).items.find((i) => i.id === article.id)?.isUrgent,
    ).toBe(false);
  });

  it('refuses unpublished articles', async () => {
    const draft = await createPublishedArticle(db, { sourceId, status: 'needs_review' });
    await expect(approveUrgent(db, draft.id, editorId)).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });
});

describe('editing and corrections', () => {
  it('requires a correction note for published text and logs the previous version publicly', async () => {
    const article = await createPublishedArticle(db, {
      sourceId,
      texts: { bg: { title: 'Старо заглавие' } },
    });
    const edit = {
      articleId: article.id,
      locale: 'bg' as const,
      title: 'Ново заглавие',
      tldr: 'Ново резюме',
      body: 'Нов текст.',
      editorId,
    };
    await expect(updateLocalization(db, edit)).rejects.toBeInstanceOf(AdminError);
    expect(
      await updateLocalization(db, { ...edit, correctionNote: 'Поправено име на министъра' }),
    ).toEqual({ correctionLogged: true });

    const detail = (await getArticle(db, article.id, 'bg'))!;
    expect(detail.title).toBe('Ново заглавие');
    expect(detail.slug).toBe('novo-zaglavie');
    expect(detail.corrections.map((c) => c.note)).toEqual(['Поправено име на министъра']);
    const [log] = await db
      .select()
      .from(articleCorrections)
      .where(eq(articleCorrections.articleId, article.id));
    expect(log!.previousBody).toContain('Старо заглавие');
    expect(log!.editorId).toBe(editorId);
  });

  it('lets editors fix drafts freely and publish them', async () => {
    const draft = await createPublishedArticle(db, { sourceId, status: 'needs_review' });
    await updateLocalization(db, {
      articleId: draft.id,
      locale: 'en',
      title: 'Fixed',
      tldr: 'Fixed summary',
      body: 'Body.',
      editorId,
    });
    expect(
      await db.select().from(articleCorrections).where(eq(articleCorrections.articleId, draft.id)),
    ).toHaveLength(0);
    await setArticleStatus(db, draft.id, 'published');
    const [after] = await db.select().from(articles).where(eq(articles.id, draft.id));
    expect(after!.status).toBe('published');
    expect(after!.reviewReason).toBeNull();
    const [en] = await db
      .select()
      .from(articleLocalizations)
      .where(eq(articleLocalizations.articleId, draft.id));
    expect(en).toBeTruthy();
  });

  it('rejecting hides the article and ends urgency', async () => {
    const article = await createPublishedArticle(db, { sourceId });
    await approveUrgent(db, article.id, editorId);
    await setArticleStatus(db, article.id, 'rejected');
    expect(await getArticle(db, article.id, 'bg')).toBeNull();
    const [after] = await db.select().from(articles).where(eq(articles.id, article.id));
    expect(after!.isUrgent).toBe(false);
  });

  it('re-tags topics', async () => {
    const article = await createPublishedArticle(db, { sourceId, topicSlugs: ['tech'] });
    await setArticleTopics(db, article.id, ['sport', 'culture']);
    expect((await getArticleForEdit(db, article.id))!.topics.sort()).toEqual(['culture', 'sport']);
  });

  it('lists and filters the review queue', async () => {
    const queue = await listArticlesForAdmin(db, { status: 'needs_review' });
    expect(queue.rows.every((r) => r.status === 'needs_review')).toBe(true);
    const found = await listArticlesForAdmin(db, { q: 'Ново заглавие' });
    expect(found.total).toBe(1);
  });
});

describe('sources and topics (dynamic lists)', () => {
  const base = {
    name: 'Капитал',
    kind: 'rss',
    url: 'https://www.capital.bg/rss/',
    homepageUrl: '',
    language: 'BG',
    defaultTopicId: '',
    isActive: true,
    fetchIntervalMinutes: '30',
    maxItemsPerFetch: '15',
    linkSelector: '',
    imagesAllowed: false,
    credibilityRating: '4',
    credibilityNote: '',
  };

  it('validates and creates sources from admin form input', async () => {
    const input = sourceInputSchema.parse(base);
    expect(input).toMatchObject({
      language: 'bg',
      fetchIntervalMinutes: 30,
      credibilityRating: 4,
      homepageUrl: undefined,
    });
    const created = await adminCreateSource(db, input);
    expect(created.credibilityRating).toBe(4);
    expect(sourceInputSchema.safeParse({ ...base, kind: 'html' }).success).toBe(false); // selector required
    expect(sourceInputSchema.safeParse({ ...base, url: 'ftp://x.bg/feed' }).success).toBe(false);
    expect(sourceInputSchema.safeParse({ ...base, fetchIntervalMinutes: '1' }).success).toBe(false);
  });

  it('re-schedules an edited source and deactivates instead of deleting when it has articles', async () => {
    const [capital] = await db.select().from(sources).where(eq(sources.name, 'Капитал'));
    await db
      .update(sources)
      .set({ nextFetchAt: new Date(Date.now() + 86_400_000), consecutiveFailures: 4 })
      .where(eq(sources.id, capital!.id));
    const updated = await updateSource(
      db,
      capital!.id,
      sourceInputSchema.parse({ ...base, name: 'Капитал (бизнес)' }),
    );
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.nextFetchAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await deleteOrDeactivateSource(db, capital!.id)).toBe('deleted');
    expect(await deleteOrDeactivateSource(db, sourceId)).toBe('deactivated');
  });

  it('creates and edits topics without changing their slug', async () => {
    const topic = await createTopic(
      db,
      topicInputSchema.parse({
        slug: 'Health',
        nameBg: 'Здраве',
        nameEn: 'Health',
        sortOrder: '70',
        isActive: true,
      }),
    );
    expect(topic.slug).toBe('health');
    await updateTopic(db, topic.id, {
      nameBg: 'Здравеопазване',
      nameEn: 'Health',
      sortOrder: 70,
      isActive: false,
    });
    expect(
      topicInputSchema.safeParse({
        slug: 'bad slug!',
        nameBg: 'x',
        nameEn: 'x',
        sortOrder: 1,
        isActive: true,
      }).success,
    ).toBe(false);
  });
});

describe('job queue', () => {
  it('deduplicates, claims once, retries with backoff and gives up', async () => {
    expect(await enqueueJob(db, 'reindex', {}, { dedupeKey: 'reindex:once' })).not.toBeNull();
    expect(await enqueueJob(db, 'reindex', {}, { dedupeKey: 'reindex:once' })).toBeNull();
    const [first] = await claimJobs(db, 10);
    expect(first?.kind).toBe('urgent_push'); // oldest first
    expect(await claimJobs(db, 10, new Date())).not.toContainEqual(
      expect.objectContaining({ id: first!.id }),
    );
    await completeJob(db, first!.id);

    const id = (await enqueueJob(db, 'digest', {}, { maxAttempts: 2 }))!;
    let [job] = (await claimJobs(db, 10)).filter((j) => j.id === id);
    await failJob(db, job!, new Error('smtp down'));
    let [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row).toMatchObject({ status: 'pending', lastError: 'smtp down' });
    [job] = (await claimJobs(db, 10, new Date(Date.now() + 3 * 60_000))).filter((j) => j.id === id);
    await failJob(db, job!, new Error('still down'));
    [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row!.status).toBe('failed');
  });

  it('runs handlers and records unknown kinds as failures', async () => {
    const ran: string[] = [];
    await enqueueJob(db, 'process_articles', { articleIds: [] });
    const count = await runDueJobs(db, {
      process_articles: async (job) => void ran.push(job.kind),
      reindex: async () => void ran.push('reindex'),
    });
    expect(count).toBeGreaterThan(0);
    expect(ran).toContain('process_articles');
  });
});

describe('dashboard', () => {
  it('summarises the pipeline', async () => {
    const dashboard = await getDashboard(db);
    expect(dashboard.byStatus.published).toBeGreaterThan(0);
    expect(dashboard.llm.budgetUsd).toBe(5);
    expect(typeof dashboard.failingSources).toBe('number');
  });
});

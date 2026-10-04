'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@nm/db';
import { sources, type Locale } from '@nm/db/schema';
import {
  AdminError,
  approveUrgent,
  clearUrgent,
  setArticleStatus,
  setArticleTopics,
  setPriority,
  updateLocalization,
} from '@nm/services/admin/articles';
import { setUserRole } from '@nm/services/admin/dashboard';
import {
  createSource,
  deleteOrDeactivateSource,
  sourceInputSchema,
  updateSource,
} from '@nm/services/admin/sources';
import { createTopic, topicInputSchema, updateTopic } from '@nm/services/admin/topics';
import { requeueArticles } from '@nm/services/ai/process';
import { deleteSession } from '@nm/services/auth/accounts';
import { SESSION_COOKIE } from '@nm/services/auth/session';
import {
  createIngestDeps,
  ingestSource,
  type SourceIngestResult,
} from '@nm/services/ingestion/ingest';
import { enqueueJob } from '@nm/services/jobs/queue';
import { requireStaff } from '@/lib/admin-auth';

export type ActionState = { ok?: string; error?: string } | null;

/** Public pages are cached; refresh them after anything readers can see changes. */
function refreshPublicPages() {
  revalidatePath('/[locale]', 'layout');
}

const str = (form: FormData, key: string) => String(form.get(key) ?? '');
const uuid = z.string().uuid();

function fail(error: unknown): ActionState {
  if (error instanceof AdminError) {
    return {
      error:
        error.code === 'correction_note_required'
          ? 'This article is published: describe the correction for the public correction log.'
          : error.message,
    };
  }
  if (error instanceof z.ZodError)
    return { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { error: (error as Error).message };
}

// Session -----------------------------------------------------------------------

export async function signOut() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), token);
  store.delete(SESSION_COOKIE);
  redirect('/admin/login');
}

// Articles ----------------------------------------------------------------------

export async function saveLocalization(_prev: ActionState, form: FormData): Promise<ActionState> {
  const editor = await requireStaff();
  try {
    const articleId = uuid.parse(str(form, 'articleId'));
    const result = await updateLocalization(getDb(), {
      articleId,
      locale: z.enum(['bg', 'en']).parse(str(form, 'locale')) as Locale,
      title: str(form, 'title'),
      tldr: str(form, 'tldr'),
      body: str(form, 'body'),
      correctionNote: str(form, 'correctionNote') || null,
      editorId: editor.id,
    });
    refreshPublicPages();
    return {
      ok: result.correctionLogged ? 'Saved — correction added to the public log.' : 'Saved.',
    };
  } catch (error) {
    return fail(error);
  }
}

export async function articleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const editor = await requireStaff();
  const db = getDb();
  try {
    const articleId = uuid.parse(str(form, 'articleId'));
    switch (str(form, 'intent')) {
      case 'publish':
        await setArticleStatus(db, articleId, 'published');
        break;
      case 'reject':
        await setArticleStatus(db, articleId, 'rejected');
        break;
      case 'approve-urgent':
        await approveUrgent(db, articleId, editor.id, Number(str(form, 'hours')) || undefined);
        break;
      case 'clear-urgent':
        await clearUrgent(db, articleId);
        break;
      case 'priority':
        await setPriority(
          db,
          articleId,
          str(form, 'priority') === 'flagship' ? 'flagship' : 'normal',
        );
        break;
      case 'reprocess':
        await requeueArticles(db, [articleId]);
        await enqueueJob(db, 'process_articles', { articleIds: [articleId] });
        break;
      case 'topics':
        await setArticleTopics(db, articleId, form.getAll('topics').map(String));
        break;
      default:
        return { error: 'Unknown action' };
    }
    refreshPublicPages();
    revalidatePath(`/admin/articles/${articleId}`);
    return { ok: 'Done.' };
  } catch (error) {
    return fail(error);
  }
}

// Sources -----------------------------------------------------------------------

function sourceFromForm(form: FormData) {
  return sourceInputSchema.parse({
    name: str(form, 'name'),
    kind: str(form, 'kind'),
    url: str(form, 'url'),
    homepageUrl: str(form, 'homepageUrl'),
    language: str(form, 'language'),
    defaultTopicId: str(form, 'defaultTopicId'),
    isActive: form.get('isActive') === 'on',
    fetchIntervalMinutes: str(form, 'fetchIntervalMinutes'),
    maxItemsPerFetch: str(form, 'maxItemsPerFetch'),
    linkSelector: str(form, 'linkSelector'),
    imagesAllowed: form.get('imagesAllowed') === 'on',
    credibilityRating: str(form, 'credibilityRating'),
    credibilityNote: str(form, 'credibilityNote'),
  });
}

export async function saveSource(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  let id = str(form, 'id');
  try {
    const input = sourceFromForm(form);
    if (id) await updateSource(getDb(), uuid.parse(id), input);
    else id = (await createSource(getDb(), input)).id;
  } catch (error) {
    if (/unique|duplicate/i.test((error as Error).message))
      return { error: 'A source with this URL already exists.' };
    return fail(error);
  }
  revalidatePath('/admin/sources');
  redirect(`/admin/sources/${id}?saved=1`);
}

export async function removeSource(form: FormData) {
  await requireStaff();
  const outcome = await deleteOrDeactivateSource(getDb(), uuid.parse(str(form, 'id')));
  revalidatePath('/admin/sources');
  redirect(`/admin/sources?${outcome}=1`);
}

export async function fetchSourceNow(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  await enqueueJob(getDb(), 'ingest_sources', { sourceIds: [uuid.parse(str(form, 'id'))] });
  return {
    ok: 'Queued — the worker fetches it within seconds; new articles then go to AI processing.',
  };
}

export type TestSourceState = { result?: SourceIngestResult; error?: string } | null;

/** Dry run: what would be ingested right now, without saving anything. */
export async function testSource(_prev: TestSourceState, form: FormData): Promise<TestSourceState> {
  await requireStaff();
  try {
    const [source] = await getDb()
      .select()
      .from(sources)
      .where(eq(sources.id, uuid.parse(str(form, 'id'))));
    if (!source) return { error: 'Source not found' };
    return { result: await ingestSource(createIngestDeps(getDb()), source, { dryRun: true }) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

// Topics ------------------------------------------------------------------------

export async function saveTopic(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  try {
    const id = str(form, 'id');
    const input = topicInputSchema.parse({
      slug: id ? 'existing' : str(form, 'slug'),
      nameBg: str(form, 'nameBg'),
      nameEn: str(form, 'nameEn'),
      sortOrder: str(form, 'sortOrder') || '0',
      isActive: form.get('isActive') === 'on',
    });
    if (id) {
      const { slug: _slug, ...rest } = input;
      await updateTopic(getDb(), uuid.parse(id), rest);
    } else {
      await createTopic(getDb(), input);
    }
    refreshPublicPages();
    revalidatePath('/admin/topics');
    return { ok: 'Saved.' };
  } catch (error) {
    if (/unique|duplicate/i.test((error as Error).message))
      return { error: 'That slug is already used.' };
    return fail(error);
  }
}

// Operations --------------------------------------------------------------------

export async function runPipelineNow(form: FormData) {
  await requireStaff();
  const what = str(form, 'what');
  if (what === 'ingest') await enqueueJob(getDb(), 'ingest_sources', {});
  if (what === 'process') await enqueueJob(getDb(), 'process_articles', {});
  if (what === 'reindex')
    await enqueueJob(
      getDb(),
      'reindex',
      {},
      { dedupeKey: `reindex:${new Date().toISOString().slice(0, 16)}` },
    );
  revalidatePath('/admin/runs');
  redirect('/admin/runs?queued=1');
}

export async function changeRole(form: FormData) {
  const admin = await requireStaff('admin');
  await setUserRole(
    getDb(),
    admin.id,
    uuid.parse(str(form, 'userId')),
    z.enum(['reader', 'editor', 'admin']).parse(str(form, 'role')),
  );
  revalidatePath('/admin/users');
}

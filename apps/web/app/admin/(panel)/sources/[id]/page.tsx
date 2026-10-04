import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@nm/db';
import { sources } from '@nm/db/schema';
import { listAllTopics } from '@nm/services/admin/topics';
import { ActionForm } from '@/components/admin/ActionForm';
import { SourceForm } from '@/components/admin/SourceForm';
import { TestSource } from '@/components/admin/TestSource';
import { fetchSourceNow, removeSource } from '../../actions';

export const metadata = { title: 'Source' };

export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [[source], topics] = await Promise.all([
    db.select().from(sources).where(eq(sources.id, id)),
    listAllTopics(db),
  ]);
  if (!source) notFound();
  return (
    <>
      <p className="hint">
        <Link href="/admin/sources">← Sources</Link>
      </p>
      <h1>{source.name}</h1>
      {saved ? <p className="notice">Saved. It will be fetched on the next worker tick.</p> : null}
      <div className="editor" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <section className="panel">
          <SourceForm source={source} topics={topics} />
        </section>
        <aside style={{ display: 'grid', gap: '1rem' }}>
          <section className="panel">
            <h3>Check the source</h3>
            <TestSource id={source.id} />
            <ActionForm action={fetchSourceNow}>
              <input type="hidden" name="id" value={source.id} />
              <button className="button button--ghost" type="submit">
                Fetch now
              </button>
            </ActionForm>
          </section>
          <section className="panel">
            <h3>Remove</h3>
            <form action={removeSource}>
              <input type="hidden" name="id" value={source.id} />
              <button className="button button--danger" type="submit">
                Delete (or deactivate if it has articles)
              </button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}

import Link from 'next/link';
import { getDb } from '@nm/db';
import { listAllTopics } from '@nm/services/admin/topics';
import { SourceForm } from '@/components/admin/SourceForm';

export const metadata = { title: 'Add source' };

export default async function NewSourcePage() {
  return (
    <>
      <p className="hint">
        <Link href="/admin/sources">← Sources</Link>
      </p>
      <h1>Add source</h1>
      <section className="panel" style={{ maxWidth: 820 }}>
        <SourceForm topics={await listAllTopics(getDb())} />
      </section>
    </>
  );
}

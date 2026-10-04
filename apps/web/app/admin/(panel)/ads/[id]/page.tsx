import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@nm/db';
import { adSlots } from '@nm/db/schema';
import { AdForm } from '@/components/admin/AdForm';
import { deleteAdAction } from '../actions';

export const metadata = { title: 'Ad' };

export default async function AdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [ad] = await getDb().select().from(adSlots).where(eq(adSlots.id, id));
  if (!ad) notFound();
  return (
    <>
      <p className="hint">
        <Link href="/admin/ads">← Ads</Link>
      </p>
      <h1>{ad.name}</h1>
      {saved ? <p className="notice">Saved. It appears on the site within seconds.</p> : null}
      <div className="editor" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <section className="panel">
          <AdForm ad={ad} />
        </section>
        <aside style={{ display: 'grid', gap: '1rem' }}>
          <section className="panel">
            <h3>Preview</h3>
            <img
              src={ad.imageUrl}
              alt={ad.altText}
              style={{ maxWidth: '100%', border: '1px solid var(--rule)' }}
            />
            <p className="hint">
              {ad.width}×{ad.height} · {ad.impressions} impressions · {ad.clicks} clicks
            </p>
          </section>
          <section className="panel">
            <form action={deleteAdAction}>
              <input type="hidden" name="id" value={ad.id} />
              <button className="button button--danger" type="submit">
                Delete ad
              </button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}

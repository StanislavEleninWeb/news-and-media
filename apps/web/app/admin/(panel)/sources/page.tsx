import Link from 'next/link';
import { getDb } from '@nm/db';
import { listSourcesForAdmin } from '@nm/services/admin/sources';

export const metadata = { title: 'Sources' };

const fmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Sofia',
});

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; deactivated?: string }>;
}) {
  const params = await searchParams;
  const rows = await listSourcesForAdmin(getDb());
  return (
    <>
      <h1>Sources</h1>
      {params.deleted ? <p className="notice">Source deleted.</p> : null}
      {params.deactivated ? (
        <p className="notice">The source has articles, so it was deactivated instead of deleted.</p>
      ) : null}
      <div className="admin-toolbar">
        <Link className="button" href="/admin/sources/new">
          + Add source
        </Link>
        <span className="hint">
          Sources are fetched by the worker on their own interval. Changes apply on the next tick.
        </span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type / lang</th>
              <th>Every</th>
              <th>Last fetch</th>
              <th>Articles (7 d)</th>
              <th>Images</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ source, articlesLast7Days }) => (
              <tr key={source.id} style={source.isActive ? undefined : { opacity: 0.55 }}>
                <td>
                  <Link href={`/admin/sources/${source.id}`}>{source.name}</Link>
                  {source.isActive ? null : (
                    <span className="status" style={{ marginLeft: 6 }}>
                      paused
                    </span>
                  )}
                  <div className="hint">{source.url}</div>
                </td>
                <td>
                  {source.kind} · {source.language}
                </td>
                <td>{source.fetchIntervalMinutes} min</td>
                <td>
                  <span className={`status status--${source.lastStatus}`}>{source.lastStatus}</span>{' '}
                  {source.lastFetchedAt ? fmt.format(source.lastFetchedAt) : ''}
                  {source.consecutiveFailures ? (
                    <div className="hint">
                      {source.consecutiveFailures} failures: {source.lastError?.slice(0, 120)}
                    </div>
                  ) : null}
                </td>
                <td>{articlesLast7Days}</td>
                <td>{source.imagesAllowed ? 'licensed' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

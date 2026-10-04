import Link from 'next/link';
import { getDb } from '@nm/db';
import type { ArticleStatus } from '@nm/db/schema';
import { listArticlesForAdmin } from '@nm/services/admin/articles';

export const metadata = { title: 'Articles' };

const statuses = [
  'all',
  'needs_review',
  'published',
  'ingested',
  'processing',
  'failed',
  'rejected',
] as const;
const fmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Sofia',
});

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = (statuses as readonly string[]).includes(params.status ?? '')
    ? (params.status as ArticleStatus | 'all')
    : 'all';
  const page = Math.max(1, Number(params.page) || 1);
  const { rows, total, perPage } = await listArticlesForAdmin(getDb(), {
    status,
    q: params.q,
    page,
  });
  const link = (p: Record<string, string>) =>
    `/admin/articles?${new URLSearchParams({ status, ...(params.q ? { q: params.q } : {}), ...p })}`;
  return (
    <>
      <h1>{status === 'needs_review' ? 'Review queue' : 'Articles'}</h1>
      <form className="admin-toolbar">
        <select className="select" name="status" defaultValue={status}>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <input className="input" name="q" defaultValue={params.q} placeholder="Search titles…" />
        <button className="button" type="submit">
          Filter
        </button>
        <span className="hint">{total} articles</span>
      </form>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Title</th>
              <th>Source</th>
              <th>Status</th>
              <th>Ingested</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const urgent =
                row.isUrgent &&
                row.urgentApprovedAt &&
                (!row.urgentExpiresAt || row.urgentExpiresAt > new Date());
              return (
                <tr key={row.id}>
                  <td>
                    <Link href={`/admin/articles/${row.id}`}>
                      {row.titleBg ?? row.originalTitle}
                    </Link>
                    {urgent ? (
                      <span className="badge-urgent" style={{ marginLeft: 8, fontSize: 11 }}>
                        URGENT
                      </span>
                    ) : null}
                    {row.priority === 'flagship' ? (
                      <span className="status" style={{ marginLeft: 8 }}>
                        flagship
                      </span>
                    ) : null}
                    {row.reviewReason ? <div className="hint">{row.reviewReason}</div> : null}
                    {row.status === 'failed' && row.lastProcessError ? (
                      <div className="hint">{row.lastProcessError.slice(0, 160)}</div>
                    ) : null}
                  </td>
                  <td>
                    {row.sourceName} <span className="hint">({row.originalLanguage})</span>
                  </td>
                  <td>
                    <span className={`status status--${row.status}`}>
                      {row.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{fmt.format(row.ingestedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="admin-toolbar" style={{ marginTop: '1rem' }}>
        {page > 1 ? (
          <Link className="button button--ghost" href={link({ page: String(page - 1) })}>
            ← Newer
          </Link>
        ) : null}
        {page * perPage < total ? (
          <Link className="button button--ghost" href={link({ page: String(page + 1) })}>
            Older →
          </Link>
        ) : null}
      </div>
    </>
  );
}

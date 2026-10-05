import Link from 'next/link';
import { getDb } from '@nm/db';
import { getDashboard } from '@nm/services/admin/dashboard';

export const metadata = { title: 'Dashboard' };

const fmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Sofia',
});

export default async function Dashboard() {
  const d = await getDashboard(getDb());
  const spendPct = d.llm.budgetUsd ? Math.round((d.llm.spentUsd / d.llm.budgetUsd) * 100) : 0;
  return (
    <>
      <h1>Dashboard</h1>
      <div className="kpis">
        <div className="kpi">
          <strong>{d.publishedLast24h}</strong>
          <span>published in the last 24 h</span>
        </div>
        <Link className="kpi" href="/admin/articles?status=needs_review">
          <strong>{d.byStatus.needs_review ?? 0}</strong>
          <span>waiting for review</span>
        </Link>
        <div className="kpi">
          <strong>{(d.byStatus.ingested ?? 0) + (d.byStatus.processing ?? 0)}</strong>
          <span>in the AI queue</span>
        </div>
        <Link className="kpi" href="/admin/articles?status=failed">
          <strong>{d.byStatus.failed ?? 0}</strong>
          <span>failed processing</span>
        </Link>
        <Link className="kpi" href="/admin/sources">
          <strong>{d.failingSources}</strong>
          <span>sources with fetch errors</span>
        </Link>
        <div className="kpi">
          <strong>${d.llm.spentUsd.toFixed(2)}</strong>
          <span>
            AI spend this month · {spendPct}% of ${d.llm.budgetUsd}
          </span>
        </div>
        <div className="kpi">
          <strong>${d.chat.spentUsd.toFixed(2)}</strong>
          <span>Reader chat spend · budget ${d.chat.budgetUsd}</span>
        </div>
      </div>
      <h2>Recent pipeline runs</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Started</th>
              <th>Kind</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Stats</th>
            </tr>
          </thead>
          <tbody>
            {d.recentRuns.map((run) => (
              <tr key={run.id}>
                <td>{fmt.format(run.startedAt)}</td>
                <td>{run.kind}</td>
                <td>{run.trigger}</td>
                <td>
                  <span className={`status status--${run.status}`}>{run.status}</span>
                </td>
                <td>
                  {Object.entries(run.stats)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                  {run.errorSummary ? (
                    <div className="hint">{run.errorSummary.split('\n')[0]}</div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

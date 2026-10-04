import { getDb } from '@nm/db';
import { listRecentJobs, listRecentRuns } from '@nm/services/admin/dashboard';
import { runPipelineNow } from '../actions';

export const metadata = { title: 'Runs & jobs' };

const fmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'Europe/Sofia',
});

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ queued?: string }>;
}) {
  const { queued } = await searchParams;
  const db = getDb();
  const [runs, jobs] = await Promise.all([listRecentRuns(db), listRecentJobs(db)]);
  return (
    <>
      <h1>Runs &amp; jobs</h1>
      {queued ? (
        <p className="notice">
          Queued — the worker picks it up within a few seconds. Refresh to see progress.
        </p>
      ) : null}
      <div className="admin-toolbar">
        {[
          ['ingest', 'Fetch all due sources now'],
          ['process', 'Run AI processing now'],
          ['reindex', 'Rebuild search index'],
        ].map(([what, label]) => (
          <form key={what} action={runPipelineNow}>
            <input type="hidden" name="what" value={what} />
            <button className="button button--ghost" type="submit">
              {label}
            </button>
          </form>
        ))}
      </div>
      <h2>Pipeline runs</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Started</th>
              <th>Kind</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Stats / errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
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
                    <pre className="hint" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                      {run.errorSummary}
                    </pre>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Jobs</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Created</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{fmt.format(job.createdAt)}</td>
                <td>{job.kind}</td>
                <td>
                  <span className={`status status--${job.status}`}>{job.status}</span>
                </td>
                <td>
                  {job.attempts}/{job.maxAttempts}
                </td>
                <td className="hint">{job.lastError}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

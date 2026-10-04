'use client';

import { useActionState } from 'react';
import { testSource, type TestSourceState } from '@/app/admin/(panel)/actions';

/** "Test fetch": shows what the scraper would pick up from this source right now. */
export function TestSource({ id }: { id: string }) {
  const [state, action, pending] = useActionState<TestSourceState, FormData>(testSource, null);
  const result = state?.result;
  return (
    <form action={action} className="admin-form">
      <input type="hidden" name="id" value={id} />
      <button className="button button--ghost" type="submit" disabled={pending}>
        {pending ? 'Fetching…' : 'Test fetch (dry run)'}
      </button>
      {state?.error ? <p className="notice notice--error">{state.error}</p> : null}
      {result ? (
        <div className="notice">
          <p>
            <strong>{result.found}</strong> items found,{' '}
            <strong>{result.preview?.items.length ?? 0}</strong> new.
            {Object.entries(result.skipped).map(
              ([reason, n]) => ` ${n} ${reason.replace('_', ' ')}.`,
            )}
          </p>
          {result.preview?.sample ? (
            <p>
              Sample extraction from{' '}
              <em>{result.preview.sample.title ?? result.preview.sample.url}</em>:{' '}
              {result.preview.sample.textLength} characters.
              {result.preview.sample.textLength < 400
                ? ' ⚠ Too short — check the source or the selector.'
                : ' ✓'}
            </p>
          ) : null}
          {result.errors.length ? (
            <p className="notice notice--error">{result.errors.join('\n')}</p>
          ) : null}
          <ol className="preview-list">
            {result.preview?.items.slice(0, 10).map((item) => (
              <li key={item.link}>
                <a href={item.link} target="_blank" rel="noreferrer">
                  {item.title ?? item.link}
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </form>
  );
}

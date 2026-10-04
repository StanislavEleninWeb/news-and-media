import type { sources, topics } from '@nm/db/schema';
import { saveSource } from '@/app/admin/(panel)/actions';
import { ActionForm } from './ActionForm';

type Source = typeof sources.$inferSelect;
type Topic = typeof topics.$inferSelect;

export function SourceForm({ source, topics }: { source?: Source; topics: Topic[] }) {
  return (
    <ActionForm action={saveSource}>
      {source ? <input type="hidden" name="id" value={source.id} /> : null}
      <div className="form-grid">
        <label className="field">
          Name
          <input className="input" name="name" defaultValue={source?.name} required />
        </label>
        <label className="field">
          Type
          <select className="select" name="kind" defaultValue={source?.kind ?? 'rss'}>
            <option value="rss">RSS / Atom feed</option>
            <option value="html">HTML listing page</option>
          </select>
        </label>
        <label className="field">
          Language (ISO code)
          <input
            className="input"
            name="language"
            defaultValue={source?.language ?? 'bg'}
            maxLength={2}
            required
          />
        </label>
      </div>
      <label className="field">
        Feed or listing-page URL
        <input
          className="input"
          name="url"
          type="url"
          defaultValue={source?.url}
          required
          style={{ width: '100%' }}
        />
      </label>
      <label className="field">
        Homepage (shown to readers)
        <input
          className="input"
          name="homepageUrl"
          type="url"
          defaultValue={source?.homepageUrl ?? ''}
          style={{ width: '100%' }}
        />
      </label>
      <label className="field">
        Link selector — HTML sources only (CSS, e.g. <code>.news-list h3 a</code>)
        <input
          className="input"
          name="linkSelector"
          defaultValue={source?.linkSelector ?? ''}
          style={{ width: '100%' }}
        />
      </label>
      <div className="form-grid">
        <label className="field">
          Fetch every (minutes)
          <input
            className="input"
            name="fetchIntervalMinutes"
            type="number"
            min={10}
            max={1440}
            defaultValue={source?.fetchIntervalMinutes ?? 60}
          />
        </label>
        <label className="field">
          Max new items per fetch
          <input
            className="input"
            name="maxItemsPerFetch"
            type="number"
            min={1}
            max={100}
            defaultValue={source?.maxItemsPerFetch ?? 20}
          />
        </label>
        <label className="field">
          Default topic
          <select
            className="select"
            name="defaultTopicId"
            defaultValue={source?.defaultTopicId ?? ''}
          >
            <option value="">—</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameEn}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Reliability (shown to readers)
          <select
            className="select"
            name="credibilityRating"
            defaultValue={source?.credibilityRating ? String(source.credibilityRating) : ''}
          >
            <option value="">Not rated</option>
            <option value="1">1 — low</option>
            <option value="2">2 — below average</option>
            <option value="3">3 — average</option>
            <option value="4">4 — high</option>
            <option value="5">5 — very high</option>
          </select>
        </label>
      </div>
      <label className="field">
        Reliability note (optional, public)
        <input
          className="input"
          name="credibilityNote"
          defaultValue={source?.credibilityNote ?? ''}
          maxLength={500}
          style={{ width: '100%' }}
        />
      </label>
      <label className="check">
        <input type="checkbox" name="isActive" defaultChecked={source?.isActive ?? true} /> Active
        (fetched on schedule)
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="imagesAllowed"
          defaultChecked={source?.imagesAllowed ?? false}
        />{' '}
        We are licensed to reuse this source&apos;s images
      </label>
      <div>
        <button className="button" type="submit">
          {source ? 'Save source' : 'Add source'}
        </button>
      </div>
    </ActionForm>
  );
}

import { getDb } from '@nm/db';
import { listAllTopics } from '@nm/services/admin/topics';
import { ActionForm } from '@/components/admin/ActionForm';
import { saveTopic } from '../actions';

export const metadata = { title: 'Topics' };

export default async function TopicsPage() {
  const topics = await listAllTopics(getDb());
  return (
    <>
      <h1>Topics</h1>
      <p className="hint" style={{ marginBottom: '1rem' }}>
        Topics drive navigation, reader preferences and AI classification (the AI only picks active
        topics). The slug is part of public URLs and cannot be changed — deactivate a topic instead
        of deleting it.
      </p>
      <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 900 }}>
        {topics.map((topic) => (
          <ActionForm key={topic.id} action={saveTopic} className="panel">
            <input type="hidden" name="id" value={topic.id} />
            <div className="form-grid" style={{ alignItems: 'end' }}>
              <span className="field">
                Slug
                <code>{topic.slug}</code>
              </span>
              <label className="field">
                Bulgarian
                <input className="input" name="nameBg" defaultValue={topic.nameBg} required />
              </label>
              <label className="field">
                English
                <input className="input" name="nameEn" defaultValue={topic.nameEn} required />
              </label>
              <label className="field">
                Order
                <input
                  className="input"
                  name="sortOrder"
                  type="number"
                  defaultValue={topic.sortOrder}
                />
              </label>
              <label className="check">
                <input type="checkbox" name="isActive" defaultChecked={topic.isActive} /> Active
              </label>
              <button className="button button--ghost" type="submit">
                Save
              </button>
            </div>
          </ActionForm>
        ))}
        <h2>Add a topic</h2>
        <ActionForm action={saveTopic} className="panel">
          <div className="form-grid" style={{ alignItems: 'end' }}>
            <label className="field">
              Slug (URL)
              <input
                className="input"
                name="slug"
                placeholder="e.g. health"
                required
                pattern="[a-z0-9-]{2,40}"
              />
            </label>
            <label className="field">
              Bulgarian
              <input className="input" name="nameBg" required />
            </label>
            <label className="field">
              English
              <input className="input" name="nameEn" required />
            </label>
            <label className="field">
              Order
              <input className="input" name="sortOrder" type="number" defaultValue={100} />
            </label>
            <label className="check">
              <input type="checkbox" name="isActive" defaultChecked /> Active
            </label>
            <button className="button" type="submit">
              Add topic
            </button>
          </div>
        </ActionForm>
      </div>
    </>
  );
}

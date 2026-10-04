import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@nm/db';
import { DEFAULT_URGENT_HOURS, getArticleForEdit } from '@nm/services/admin/articles';
import { listAllTopics } from '@nm/services/admin/topics';
import { articlePath } from '@nm/services/content/contracts';
import { mediaUrl } from '@nm/services/storage';
import { ActionForm } from '@/components/admin/ActionForm';
import { articleAction, saveLocalization } from '../../actions';

export const metadata = { title: 'Edit article' };

const UUID = /^[0-9a-f-]{36}$/i;
const fmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Sofia',
});

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const [item, topics] = await Promise.all([getArticleForEdit(db, id), listAllTopics(db)]);
  if (!item) notFound();
  const { article, source, image, localizations, corrections } = item;
  const published = article.status === 'published';
  const urgentActive =
    article.isUrgent &&
    article.urgentApprovedAt &&
    (!article.urgentExpiresAt || article.urgentExpiresAt > new Date());
  const hidden = (intent: string) => (
    <>
      <input type="hidden" name="articleId" value={article.id} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );

  return (
    <>
      <p className="hint">
        <Link href="/admin/articles">← Articles</Link>
      </p>
      <h1>{localizations.find((l) => l.locale === 'bg')?.title ?? article.originalTitle}</h1>
      <div className="admin-toolbar">
        <span className={`status status--${article.status}`}>
          {article.status.replace('_', ' ')}
        </span>
        {urgentActive ? (
          <span className="badge-urgent">URGENT until {fmt.format(article.urgentExpiresAt!)}</span>
        ) : null}
        {article.reviewReason ? <span className="notice">{article.reviewReason}</span> : null}
        {published
          ? localizations.map((l) => (
              <Link
                key={l.locale}
                className="button button--ghost"
                href={articlePath(l.locale, article.id, l.slug)}
                target="_blank"
              >
                View {l.locale.toUpperCase()} ↗
              </Link>
            ))
          : null}
      </div>

      <div className="editor">
        <section className="panel">
          <h2>Source · {source.name}</h2>
          <p className="hint">
            {article.originalLanguage.toUpperCase()} · ingested {fmt.format(article.ingestedAt)} ·{' '}
            <a href={article.originalUrl} target="_blank" rel="noreferrer">
              original ↗
            </a>
          </p>
          <h3>{article.originalTitle}</h3>
          <div className="raw-text">{article.rawText}</div>
          {article.lastProcessError ? (
            <p className="notice notice--error">Last AI error: {article.lastProcessError}</p>
          ) : null}
        </section>

        <div style={{ display: 'grid', gap: '1rem' }}>
          {(['bg', 'en'] as const).map((locale) => {
            const loc = localizations.find((l) => l.locale === locale);
            return (
              <section className="panel" key={locale}>
                <h2>
                  {locale === 'bg' ? 'Bulgarian' : 'English'}{' '}
                  {loc ? (
                    <span className="hint">
                      ({loc.isTranslation ? 'translation' : 'rewrite'} · {loc.model})
                    </span>
                  ) : null}
                </h2>
                <ActionForm action={saveLocalization}>
                  <input type="hidden" name="articleId" value={article.id} />
                  <input type="hidden" name="locale" value={locale} />
                  <label className="field">
                    Title
                    <input
                      className="input"
                      name="title"
                      defaultValue={loc?.title}
                      required
                      maxLength={200}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label className="field">
                    In short (TL;DR)
                    <textarea name="tldr" defaultValue={loc?.tldr} rows={3} required />
                  </label>
                  <label className="field">
                    Body (blank line between paragraphs)
                    <textarea name="body" defaultValue={loc?.body} rows={16} required />
                  </label>
                  {published && loc ? (
                    <label className="field">
                      Correction note (public, required when changing published text)
                      <input
                        className="input"
                        name="correctionNote"
                        placeholder="e.g. Corrected the minister's name"
                        style={{ width: '100%' }}
                      />
                    </label>
                  ) : null}
                  <button className="button" type="submit">
                    Save {locale.toUpperCase()}
                  </button>
                </ActionForm>
              </section>
            );
          })}
        </div>

        <aside style={{ display: 'grid', gap: '1rem' }}>
          <section className="panel">
            <h3>Publication</h3>
            {!published ? (
              <ActionForm action={articleAction}>
                {hidden('publish')}
                <button className="button" type="submit">
                  Publish
                </button>
              </ActionForm>
            ) : null}
            {article.status !== 'rejected' ? (
              <ActionForm action={articleAction} confirm="Hide this article from readers?">
                {hidden('reject')}
                <button className="button button--ghost" type="submit">
                  {published ? 'Unpublish' : 'Reject'}
                </button>
              </ActionForm>
            ) : null}
            <ActionForm
              action={articleAction}
              confirm="Run the AI rewrite again? Current text will be replaced."
            >
              {hidden('reprocess')}
              <button className="button button--ghost" type="submit">
                Re-run AI rewrite
              </button>
            </ActionForm>
          </section>

          <section className="panel">
            <h3>Breaking news</h3>
            {urgentActive ? (
              <ActionForm action={articleAction}>
                {hidden('clear-urgent')}
                <p className="hint">
                  Pinned on top and pushed to subscribers. Approved{' '}
                  {fmt.format(article.urgentApprovedAt!)}.
                </p>
                <button className="button button--ghost" type="submit">
                  End urgent status
                </button>
              </ActionForm>
            ) : published ? (
              <ActionForm
                action={articleAction}
                confirm="Approve as BREAKING NEWS? It will be pinned on top and pushed to subscribers."
              >
                {hidden('approve-urgent')}
                <label className="field">
                  Pin for
                  <select
                    className="select"
                    name="hours"
                    defaultValue={String(DEFAULT_URGENT_HOURS)}
                  >
                    {[1, 3, 6, 12, 24].map((h) => (
                      <option key={h} value={h}>
                        {h} hours
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button button--danger" type="submit">
                  Approve as urgent
                </button>
                <p className="hint">
                  Only an editor&apos;s approval makes a story urgent — never the AI.
                </p>
              </ActionForm>
            ) : (
              <p className="hint">Publish the article first.</p>
            )}
          </section>

          <section className="panel">
            <h3>Priority</h3>
            <ActionForm action={articleAction}>
              {hidden('priority')}
              <select className="select" name="priority" defaultValue={article.priority}>
                <option value="normal">Normal</option>
                <option value="flagship">Flagship (processed first, DeepL translation)</option>
              </select>
              <button className="button button--ghost" type="submit">
                Save priority
              </button>
            </ActionForm>
          </section>

          <section className="panel">
            <h3>Topics</h3>
            <ActionForm action={articleAction}>
              {hidden('topics')}
              {topics.map((topic) => (
                <label className="check" key={topic.id}>
                  <input
                    type="checkbox"
                    name="topics"
                    value={topic.slug}
                    defaultChecked={item.topics.includes(topic.slug)}
                  />
                  {topic.nameEn}
                </label>
              ))}
              <button className="button button--ghost" type="submit">
                Save topics
              </button>
            </ActionForm>
          </section>

          {image ? (
            <section className="panel">
              <h3>Image</h3>
              <img src={mediaUrl(image.storageKeyThumb) ?? ''} alt="" width={480} />
              <p className="hint">{image.licenseNote}</p>
            </section>
          ) : null}

          {corrections.length ? (
            <section className="panel">
              <h3>Correction log</h3>
              <ul className="preview-list">
                {corrections.map((c) => (
                  <li key={c.id}>
                    {fmt.format(c.createdAt)} · {c.locale.toUpperCase()}: {c.note}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

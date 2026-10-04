import type { ArticleDetail } from '@nm/services/content/contracts';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { formatDateTime } from '@/lib/format';
import { ExternalIcon } from '../Icons';

/** Transparency block under every article: AI disclosure, source, reliability, corrections. */
export function TrustPanel({ article, locale }: { article: ArticleDetail; locale: Locale }) {
  const t = getMessages(locale);
  const rating = article.source.credibilityRating;
  return (
    <aside className="source-box" aria-label={t.article.source}>
      {article.isAiRewritten ? (
        <p>
          <span className="ai-badge">{t.trust.aiLabel}</span>{' '}
          {t.trust.aiDisclosure(article.source.name)}
        </p>
      ) : null}
      {article.isTranslation ? <p>{t.trust.translated}</p> : null}
      <p>
        {t.article.source}: <strong>{article.source.name}</strong>
        {rating ? (
          <>
            {' '}
            · {t.trust.credibility}: <strong>{t.trust.credibilityLevels[rating]}</strong>
          </>
        ) : null}
      </p>
      {article.source.credibilityNote ? (
        <p className="hint">{article.source.credibilityNote}</p>
      ) : null}
      <p>
        <a href={article.originalUrl} target="_blank" rel="noopener noreferrer nofollow">
          {t.article.originalArticle}{' '}
          <ExternalIcon style={{ display: 'inline', verticalAlign: '-2px' }} />
        </a>
      </p>
      {article.corrections.length ? (
        <div className="corrections" id="corrections">
          <p>
            <strong>{t.trust.corrections}</strong> — {t.trust.correctionsHint}
          </p>
          <ul>
            {article.corrections.map((correction) => (
              <li key={correction.createdAt}>
                <time dateTime={correction.createdAt}>
                  {formatDateTime(correction.createdAt, locale)}
                </time>
                : {correction.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

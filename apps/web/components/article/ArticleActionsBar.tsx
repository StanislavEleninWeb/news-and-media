'use client';

import type { Locale } from '@/i18n/config';
import { SaveButton, ShareButton } from './ArticleActions';

export function ArticleActions({
  articleId,
  locale,
  path,
  title,
}: {
  articleId: string;
  locale: Locale;
  path: string;
  title: string;
}) {
  return (
    <div className="article__actions">
      <SaveButton articleId={articleId} locale={locale} path={path} />
      <ShareButton locale={locale} title={title} />
    </div>
  );
}

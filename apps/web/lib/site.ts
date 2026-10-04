import { cache } from 'react';
import { getConfig } from '@nm/core/config';
import { getDb } from '@nm/db';
import { listTopics } from '@nm/services/content/topics';
import type { Locale } from '@/i18n/config';

export const siteName = () => getConfig().SITE_NAME;
export const siteUrl = () => getConfig().APP_URL.replace(/\/$/, '');

/** Topic list for navigation; deduplicated per render. */
export const getNavTopics = cache(async (locale: Locale) => {
  try {
    return await listTopics(getDb(), locale);
  } catch {
    return [];
  }
});

import type { MetadataRoute } from 'next';
import { getConfig } from '@nm/core/config';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const base = getConfig().APP_URL.replace(/\/$/, '');
  const isProduction = getConfig().APP_ENV === 'production';
  return {
    rules: isProduction
      ? { userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/*/account', '/*/search'] }
      : { userAgent: '*', disallow: '/' },
    sitemap: isProduction ? `${base}/sitemap.xml` : undefined,
  };
}

import type { MetadataRoute } from 'next';
import { getConfig } from '@nm/core/config';

export const dynamic = 'force-dynamic';

/** Web app manifest — makes the site installable (Android, desktop, iOS "Add to Home Screen"). */
export default function manifest(): MetadataRoute.Manifest {
  const name = getConfig().SITE_NAME;
  return {
    name,
    short_name: name,
    description:
      'Новини и медийни тенденции на български и английски · News and media trends in Bulgarian and English',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fbfaf7',
    theme_color: '#13233a',
    lang: 'bg',
    categories: ['news'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

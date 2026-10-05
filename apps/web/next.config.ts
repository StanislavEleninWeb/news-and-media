import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// One `.env` at the repository root serves every app in local development.
// In containers, configuration comes from the environment (docker compose env_file).
const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * Google Ad Manager / Google CMP hosts. The CSP is fixed at build time and the
 * same image runs everywhere, so they are always allowed; scripts are only
 * loaded when ADS_PROVIDER=gam. Prebid.js is self-hosted (/media/ads/).
 */
const adScriptHosts = [
  'https://securepubads.g.doubleclick.net',
  'https://pagead2.googlesyndication.com',
  'https://tpc.googlesyndication.com',
  'https://fundingchoicesmessages.google.com',
  'https://www.googletagservices.com',
];

/**
 * Content-Security-Policy (production builds). Inline scripts are allowed because
 * Next.js and the pre-paint preferences script inject them; scripts otherwise
 * come from this origin or Google's ad stack. Ad creatives (images, iframes) and
 * header-bidding requests may use any https origin.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${adScriptHosts.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https:",
  'frame-src https:',
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }]
    : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages land in the standalone bundle.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@nm/contracts', '@nm/core', '@nm/db', '@nm/services'],
  serverExternalPackages: ['pino', 'sharp', 'linkedom', 'rss-parser'],
  poweredByHeader: false,
  // Linting runs once at the repository root (pnpm lint), not inside next build.
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,
  // Images are pre-rendered to webp renditions at ingestion time and served by Caddy.
  images: { unoptimized: true },
  // Ad creatives are uploaded through admin server actions.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/admin', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      {
        // The service worker must always be revalidated so updates reach readers quickly.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// One `.env` at the repository root serves every app in local development.
// In containers, configuration comes from the environment (docker compose env_file).
const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages land in the standalone bundle.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@nm/core', '@nm/db', '@nm/services'],
  serverExternalPackages: ['pino', 'sharp', 'linkedom', 'rss-parser'],
  poweredByHeader: false,
  // Linting runs once at the repository root (pnpm lint), not inside next build.
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,
  // Images are pre-rendered to webp renditions at ingestion time and served by Caddy.
  images: { unoptimized: true },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
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

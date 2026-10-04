import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: process.env.SITE_NAME ?? 'Newsmedia',
  description: 'News and media trends in Bulgarian and English.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bg">
      <body>{children}</body>
    </html>
  );
}

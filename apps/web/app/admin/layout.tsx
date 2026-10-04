import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/styles/globals.css';
import '@/styles/admin.css';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin' },
  robots: { index: false, follow: false },
};

/** The admin has its own root layout: English UI, no public chrome, never indexed. */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

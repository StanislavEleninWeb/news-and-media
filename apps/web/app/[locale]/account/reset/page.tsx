import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ResetClient } from '@/components/account/ResetClient';
import { isLocale } from '@/i18n/config';

export const metadata = { robots: { index: false } };

export default async function ResetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div className="container">
      <Suspense>
        <ResetClient locale={locale} />
      </Suspense>
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SavedList } from '@/components/SavedList';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: isLocale(locale) ? getMessages(locale).saved.title : undefined,
    robots: { index: false },
  };
}

/** Reading list. The page is static; the list is loaded in the browser for the signed-in reader. */
export default async function SavedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div className="container">
      <h1 className="page-title">{getMessages(locale).saved.title}</h1>
      <SavedList locale={locale} />
    </div>
  );
}

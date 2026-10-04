import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getConfig } from '@nm/core/config';
import { getDb } from '@nm/db';
import { listFollowableSources } from '@nm/services/auth/preferences';
import { AccountClient } from '@/components/account/AccountClient';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { getNavTopics } from '@/lib/site';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: isLocale(locale) ? getMessages(locale).account.title : undefined,
    robots: { index: false },
  };
}

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const config = getConfig();
  const [topics, sources] = await Promise.all([
    getNavTopics(locale),
    listFollowableSources(getDb()).catch(() => []),
  ]);
  return (
    <div className="container">
      <AccountClient
        locale={locale}
        googleEnabled={!!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET)}
        topics={topics.map((t) => ({ slug: t.slug, name: t.name }))}
        sources={sources.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}

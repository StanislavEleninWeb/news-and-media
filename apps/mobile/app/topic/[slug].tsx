import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StoryList } from '@/components/StoryList';
import type { Locale } from '@/api';
import { useSession } from '@/session';

/** All stories of one topic (opened from a story or a notification). */
export default function TopicScreen() {
  const params = useLocalSearchParams<{ slug: string; locale?: string }>();
  const session = useSession();
  const locale: Locale =
    params.locale === 'en' || params.locale === 'bg' ? params.locale : session.locale;
  const [title, setTitle] = useState('');

  useEffect(() => {
    session.api.topics(locale).then(
      (r) => setTitle(r.topics.find((x) => x.slug === params.slug)?.name ?? ''),
      () => undefined,
    );
  }, [session.api, locale, params.slug]);

  const load = useCallback(
    (page: number) => session.api.feed({ locale, topic: params.slug, page }),
    [session.api, locale, params.slug],
  );
  return (
    <>
      <Stack.Screen options={{ title }} />
      <StoryList load={load} deps={[locale, params.slug]} />
    </>
  );
}

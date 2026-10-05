import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { StoryList } from '@/components/StoryList';
import { Chip } from '@/components/ui';
import { t } from '@/i18n';
import { useSession } from '@/session';
import { space } from '@/theme';

/** Home feed: urgent first, then newest; personalised when signed in. */
export default function FeedScreen() {
  const { api, locale, user } = useSession();
  const [topics, setTopics] = useState<{ slug: string; name: string }[]>([]);
  const [topic, setTopic] = useState<string | undefined>();

  useEffect(() => {
    api.topics(locale).then(
      (r) => setTopics(r.topics),
      () => setTopics([]),
    );
  }, [api, locale]);

  const load = useCallback(
    (page: number) => api.feed({ locale, topic, page }),
    [api, locale, topic],
  );

  const chips = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
    >
      <Chip label={t(locale, 'all')} active={!topic} onPress={() => setTopic(undefined)} />
      {topics.map((item) => (
        <Chip
          key={item.slug}
          label={item.name}
          active={topic === item.slug}
          onPress={() => setTopic(item.slug)}
        />
      ))}
    </ScrollView>
  );

  return <StoryList load={load} header={chips} deps={[locale, topic, user?.id]} />;
}

const styles = StyleSheet.create({ chips: { gap: space.s, paddingVertical: space.m } });

import type { ArticleCard as Card, FeedResponse } from '@nm/contracts';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { useSession } from '../session';
import { space, usePalette } from '../theme';
import { ArticleCard } from './ArticleCard';
import { ErrorState, Loading } from './ui';

/**
 * Paged, pull-to-refresh story list used by the feed and topic screens.
 * Keeps showing the last loaded page when the network drops.
 */
export function StoryList({
  load,
  header,
  deps,
}: {
  load: (page: number) => Promise<FeedResponse>;
  header?: ReactElement;
  /** Reload from page 1 when these change (locale, topic). */
  deps: unknown[];
}) {
  const c = usePalette();
  const { locale } = useSession();
  const [items, setItems] = useState<Card[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);

  const fetchPage = useCallback(
    async (next: number) => {
      if (loading.current) return;
      loading.current = true;
      try {
        const result = await load(next);
        setItems((prev) => (next === 1 ? result.items : [...(prev ?? []), ...result.items]));
        setPage(next);
        setHasMore(result.hasMore);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        loading.current = false;
        setRefreshing(false);
      }
    },
    [load],
  );

  useEffect(() => {
    setItems(null);
    void fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  if (!items && failed) return <ErrorState locale={locale} onRetry={() => fetchPage(1)} />;
  if (!items) return <Loading />;

  return (
    <FlatList
      style={{ backgroundColor: c.paper }}
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => <ArticleCard item={item} lead={index === 0} />}
      ListHeaderComponent={
        <>
          {header}
          {failed ? (
            <Text style={[styles.offline, { color: c.accent }]}>{t(locale, 'offline')}</Text>
          ) : null}
        </>
      }
      ListFooterComponent={<View style={{ height: space.xl }} />}
      onEndReachedThreshold={0.6}
      onEndReached={() => hasMore && fetchPage(page + 1)}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={c.accent}
          onRefresh={() => {
            setRefreshing(true);
            void fetchPage(1);
          }}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.m },
  offline: { paddingVertical: space.s, fontSize: 14 },
});

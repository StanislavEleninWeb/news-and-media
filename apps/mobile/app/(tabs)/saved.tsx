import type { ArticleCard as Card } from '@nm/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { ArticleCard } from '@/components/ArticleCard';
import { Empty, Loading } from '@/components/ui';
import { t } from '@/i18n';
import { useSession } from '@/session';
import { space, usePalette } from '@/theme';

/** The reading list (synced with the website for the same account). */
export default function SavedScreen() {
  const c = usePalette();
  const { api, locale, user } = useSession();
  const [items, setItems] = useState<Card[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      api.saved(locale).then(
        (r) => setItems(r.items),
        () => setItems((prev) => prev ?? []),
      );
    }, [api, locale, user]),
  );

  if (!user) return <Empty>{t(locale, 'signInToSave')}</Empty>;
  if (!items) return <Loading />;
  return (
    <View style={[styles.screen, { backgroundColor: c.paper }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ArticleCard item={item} />}
        ListEmptyComponent={<Empty>{t(locale, 'savedEmpty')}</Empty>}
      />
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, paddingHorizontal: space.m } });

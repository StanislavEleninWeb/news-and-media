import type { SearchResponse } from '@nm/contracts';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Empty } from '@/components/ui';
import { routeForPath } from '@/links';
import { t, timeAgo } from '@/i18n';
import { useSession } from '@/session';
import { fonts, radius, space, usePalette } from '@/theme';

/** Full-text search (Typesense on the server), debounced as you type. */
export default function SearchScreen() {
  const c = usePalette();
  const { api, locale } = useSession();
  const [q, setQ] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search({ q: query, locale }).then(
        (r) => !cancelled && setResult(r),
        () => !cancelled && setResult(null),
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, q, locale]);

  return (
    <View style={[styles.screen, { backgroundColor: c.paper }]}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder={t(locale, 'searchPlaceholder')}
        placeholderTextColor={c.muted}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={[styles.input, { color: c.ink, backgroundColor: c.chip }]}
      />
      <FlatList
        data={result?.hits ?? []}
        keyExtractor={(hit) => hit.id}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={result ? <Empty>{t(locale, 'noResults')}</Empty> : null}
        renderItem={({ item }) => (
          <Link href={routeForPath(item.path) as never} asChild>
            <Pressable style={[styles.hit, { borderBottomColor: c.rule }]}>
              {item.isUrgent ? (
                <Text style={[styles.kicker, { color: c.accent }]}>{t(locale, 'breaking')}</Text>
              ) : null}
              <Text style={[styles.title, { color: c.ink, fontFamily: fonts.serif }]}>
                {item.title}
              </Text>
              <Text style={[styles.snippet, { color: c.inkSoft }]} numberOfLines={2}>
                {(item.highlight ?? item.tldr).replace(/<\/?mark>/g, '')}
              </Text>
              <Text style={[styles.meta, { color: c.muted }]}>
                {item.source} · {timeAgo(item.publishedAt, locale)}
              </Text>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space.m },
  input: { marginVertical: space.m, padding: 12, borderRadius: radius, fontSize: 17 },
  hit: { paddingVertical: space.m, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  kicker: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '600' },
  snippet: { fontSize: 15, lineHeight: 21 },
  meta: { fontSize: 13 },
});

import type { ArticleCard as Card } from '@nm/contracts';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t, timeAgo } from '../i18n';
import { useSession } from '../session';
import { fonts, radius, space, usePalette } from '../theme';

/** One story in a list. `lead` renders the large top-story layout. */
export function ArticleCard({ item, lead = false }: { item: Card; lead?: boolean }) {
  const c = usePalette();
  const { api, locale } = useSession();
  const image = api.absolute(lead ? item.imageUrl : (item.imageThumbUrl ?? item.imageUrl));
  return (
    <Link
      href={{ pathname: '/article/[id]', params: { id: item.id, locale: item.locale } }}
      asChild
    >
      <Pressable
        accessibilityRole="link"
        style={({ pressed }) => [
          styles.card,
          lead ? styles.lead : styles.row,
          { borderBottomColor: c.rule, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        {image ? (
          <Image
            source={{ uri: image, headers: api.imageHeaders }}
            style={lead ? styles.leadImage : styles.thumb}
            contentFit="cover"
            transition={150}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <View style={styles.text}>
          {item.isUrgent ? (
            <Text style={[styles.kicker, { color: c.accent }]}>{t(locale, 'breaking')}</Text>
          ) : item.topics[0] ? (
            <Text style={[styles.kicker, { color: c.muted }]}>{item.topics[0].name}</Text>
          ) : null}
          <Text
            style={[
              styles.title,
              lead && styles.leadTitle,
              { color: c.ink, fontFamily: fonts.serif },
            ]}
            numberOfLines={lead ? 4 : 3}
          >
            {item.title}
          </Text>
          {lead ? (
            <Text style={[styles.tldr, { color: c.inkSoft }]} numberOfLines={3}>
              {item.tldr}
            </Text>
          ) : null}
          <Text style={[styles.meta, { color: c.muted }]}>
            {item.source.name} · {timeAgo(item.publishedAt, locale)}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: space.m },
  row: { flexDirection: 'row-reverse', gap: space.m, alignItems: 'flex-start' },
  lead: { gap: space.m },
  thumb: { width: 96, height: 72, borderRadius: radius - 4 },
  leadImage: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius },
  text: { flex: 1, gap: 6 },
  kicker: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '600' },
  leadTitle: { fontSize: 26, lineHeight: 31 },
  tldr: { fontSize: 16, lineHeight: 23 },
  meta: { fontSize: 13 },
});

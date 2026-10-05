import type { ArticleDetail } from '@nm/contracts';
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Locale } from '@/api';
import { ArticleCard } from '@/components/ArticleCard';
import { ArticleChat } from '@/components/ArticleChat';
import { Reactions } from '@/components/Reactions';
import { ErrorState, Loading } from '@/components/ui';
import { env } from '@/env';
import { t, timeAgo } from '@/i18n';
import { useSession } from '@/session';
import { fonts, radius, space, usePalette } from '@/theme';

export default function ArticleScreen() {
  const c = usePalette();
  const params = useLocalSearchParams<{ id: string; locale?: string }>();
  const session = useSession();
  const { api, user, personalize } = session;
  const locale: Locale =
    params.locale === 'en' || params.locale === 'bg' ? params.locale : session.locale;
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    api.article(params.id, locale).then(
      (a) => {
        setArticle(a);
        void api.recordView(a.id).catch(() => undefined);
      },
      () => setFailed(true),
    );
  }, [api, params.id, locale]);
  useEffect(load, [load]);

  // Reading signals for personalisation (opt-in): the open, then reading time on leave.
  const openedAt = useRef(0);
  useEffect(() => {
    if (!personalize || !article) return;
    openedAt.current = Date.now();
    void api.sendEvents([{ articleId: article.id, kind: 'click' }]).catch(() => undefined);
    return () => {
      const dwellMs = Date.now() - openedAt.current;
      if (dwellMs >= 3_000)
        void api
          .sendEvents([
            { articleId: article.id, kind: 'dwell', dwellMs: Math.min(dwellMs, 3_600_000) },
          ])
          .catch(() => undefined);
    };
  }, [api, personalize, article]);

  useEffect(() => {
    if (!user) return;
    api.saved(locale).then(
      (r) => setSaved(r.items.some((i) => i.id === params.id)),
      () => undefined,
    );
  }, [api, user, locale, params.id]);

  const toggleSave = async () => {
    try {
      if (saved) await api.unsave(params.id);
      else await api.save(params.id);
      setSaved(!saved);
    } catch {
      // offline — leave as is
    }
  };

  if (failed) return <ErrorState locale={locale} onRetry={load} />;
  if (!article) return <Loading />;

  const headerRight = () => (
    <View style={styles.actions}>
      {user ? (
        <Pressable
          accessibilityLabel={t(locale, saved ? 'unsave' : 'save')}
          onPress={toggleSave}
          hitSlop={8}
        >
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={22} color={c.ink} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel="Share"
        hitSlop={8}
        onPress={async () => {
          const result = await Share.share({
            message: `${article.title}\n${env.apiUrl}${article.path}`,
          });
          if (personalize && result.action === Share.sharedAction)
            void api.sendEvents([{ articleId: article.id, kind: 'share' }]).catch(() => undefined);
        }}
      >
        <Ionicons name="share-outline" size={22} color={c.ink} />
      </Pressable>
    </View>
  );

  const image = api.absolute(article.imageUrl);
  return (
    <ScrollView style={{ backgroundColor: c.paper }} contentContainerStyle={styles.page}>
      <Stack.Screen options={{ headerRight }} />
      {article.isUrgent ? (
        <Text style={[styles.kicker, { color: c.accent }]}>{t(locale, 'breaking')}</Text>
      ) : null}
      <Text
        style={[styles.title, { color: c.ink, fontFamily: fonts.serif }]}
        accessibilityRole="header"
      >
        {article.title}
      </Text>
      <Text style={[styles.meta, { color: c.muted }]}>
        {article.source.name} · {timeAgo(article.publishedAt, locale)}
      </Text>
      <View style={styles.topics}>
        {article.topics.map((topic) => (
          <Link
            key={topic.slug}
            href={{ pathname: '/topic/[slug]', params: { slug: topic.slug, locale } }}
          >
            <Text style={[styles.topic, { color: c.link }]}>{topic.name}</Text>
          </Link>
        ))}
      </View>
      {image ? (
        <View style={styles.figure}>
          <Image
            source={{ uri: image, headers: api.imageHeaders }}
            style={styles.image}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
          {article.imageCredit ? (
            <Text style={[styles.credit, { color: c.muted }]}>{article.imageCredit}</Text>
          ) : null}
        </View>
      ) : null}
      <Text style={[styles.tldr, { color: c.ink, borderLeftColor: c.accent }]}>{article.tldr}</Text>
      {article.body.map((paragraph, index) => (
        <Text
          key={index}
          style={[styles.paragraph, { color: c.ink, fontFamily: fonts.serif }]}
          selectable
        >
          {paragraph}
        </Text>
      ))}

      <View style={[styles.trust, { backgroundColor: c.chip }]}>
        {article.isAiRewritten ? (
          <Text style={[styles.note, { color: c.inkSoft }]}>{t(locale, 'aiNote')}</Text>
        ) : null}
        {article.isTranslation ? (
          <Text style={[styles.note, { color: c.inkSoft }]}>{t(locale, 'translated')}</Text>
        ) : null}
        <Pressable onPress={() => WebBrowser.openBrowserAsync(article.originalUrl)}>
          <Text style={[styles.link, { color: c.link }]}>
            {t(locale, 'readOriginal')} — {article.source.name}
          </Text>
        </Pressable>
      </View>

      {article.corrections.length ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.ink }]}>{t(locale, 'corrections')}</Text>
          {article.corrections.map((fix, index) => (
            <Text key={index} style={[styles.note, { color: c.inkSoft }]}>
              {timeAgo(fix.createdAt, locale)}: {fix.note}
            </Text>
          ))}
        </View>
      ) : null}

      <Reactions articleId={article.id} />

      <ArticleChat articleId={article.id} locale={locale} />

      {article.related.length ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.ink }]}>{t(locale, 'related')}</Text>
          {article.related.map((item) => (
            <ArticleCard key={item.id} item={item} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.m, paddingBottom: space.xl * 2, gap: space.s },
  actions: { flexDirection: 'row', gap: space.m },
  kicker: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  meta: { fontSize: 14 },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m },
  topic: { fontSize: 14, fontWeight: '600' },
  figure: { marginVertical: space.s, gap: 4 },
  image: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius },
  credit: { fontSize: 12 },
  tldr: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
    borderLeftWidth: 3,
    paddingLeft: space.m,
    marginVertical: space.s,
  },
  paragraph: { fontSize: 18, lineHeight: 29 },
  trust: { borderRadius: radius, padding: space.m, gap: space.s, marginTop: space.l },
  note: { fontSize: 14, lineHeight: 20 },
  link: { fontSize: 15, fontWeight: '600' },
  section: { marginTop: space.l, gap: space.s },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
});

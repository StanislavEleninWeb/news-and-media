import { reactionKinds, type Reaction, type ReactionSummary } from '@nm/contracts';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { reactionEmoji, t } from '../i18n';
import { useSession } from '../session';
import { space, usePalette } from '../theme';

/** Reaction bar; works without an account (anonymous install id). */
export function Reactions({ articleId }: { articleId: string }) {
  const c = usePalette();
  const { api, locale } = useSession();
  const [summary, setSummary] = useState<ReactionSummary | null>(null);

  useEffect(() => {
    api.reactions(articleId).then(setSummary, () => setSummary(null));
  }, [api, articleId]);

  const choose = async (reaction: Reaction) => {
    try {
      setSummary(
        await (summary?.mine === reaction
          ? api.unreact(articleId)
          : api.react(articleId, reaction)),
      );
    } catch {
      // Rate-limited or offline: keep the current state.
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: c.muted }]}>{t(locale, 'reactions')}</Text>
      <View style={styles.row}>
        {reactionKinds.map((kind) => {
          const mine = summary?.mine === kind;
          return (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityLabel={kind}
              accessibilityState={{ selected: mine }}
              onPress={() => choose(kind)}
              style={[
                styles.pill,
                {
                  backgroundColor: mine ? c.accentSoft : c.chip,
                  borderColor: mine ? c.accent : 'transparent',
                },
              ]}
            >
              <Text style={styles.emoji}>{reactionEmoji[kind]}</Text>
              <Text style={{ color: c.inkSoft, fontVariant: ['tabular-nums'] }}>
                {summary?.counts[kind] ?? 0}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s, marginTop: space.l },
  label: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  emoji: { fontSize: 18 },
});

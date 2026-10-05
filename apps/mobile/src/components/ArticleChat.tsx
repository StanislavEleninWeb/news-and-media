import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api';
import { t } from '../i18n';
import { useSession } from '../session';
import { radius, space, usePalette } from '../theme';
import { Button } from './ui';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  refused?: boolean;
}

/** "Ask this article" — answers come only from this article (signed-in readers). */
export function ArticleChat({ articleId, locale }: { articleId: string; locale: 'bg' | 'en' }) {
  const c = usePalette();
  const { api, user } = useSession();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const q = question.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns([...turns, { role: 'user', content: q }]);
    setQuestion('');
    try {
      const reply = await api.ask(articleId, { locale, question: q, history });
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: reply.answer, refused: reply.refused },
      ]);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setError(
        t(locale, status === 429 ? 'askLimit' : status === 503 ? 'askUnavailable' : 'error'),
      );
      setTurns((prev) => prev.slice(0, -1));
      setQuestion(q);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.box, { borderColor: c.rule, backgroundColor: c.raised }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
      >
        <Text style={[styles.title, { color: c.ink }]}>
          {t(locale, 'askTitle')} {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.panel}>
          <Text style={{ color: c.muted, fontSize: 13 }}>{t(locale, 'askIntro')}</Text>
          {!user ? (
            <Text style={{ color: c.inkSoft }}>{t(locale, 'askSignIn')}</Text>
          ) : (
            <>
              {turns.map((turn, index) => (
                <View
                  key={index}
                  style={[
                    styles.bubble,
                    turn.role === 'user'
                      ? { alignSelf: 'flex-end', backgroundColor: c.brand }
                      : { alignSelf: 'flex-start', backgroundColor: c.chip },
                  ]}
                >
                  <Text
                    style={{
                      color: turn.role === 'user' ? c.paper : turn.refused ? c.muted : c.ink,
                      fontStyle: turn.refused ? 'italic' : 'normal',
                      fontSize: 15,
                      lineHeight: 21,
                    }}
                  >
                    {turn.content}
                  </Text>
                </View>
              ))}
              {busy ? <Text style={{ color: c.muted }}>…</Text> : null}
              {error ? <Text style={{ color: c.accent }}>{error}</Text> : null}
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder={t(locale, 'askPlaceholder')}
                placeholderTextColor={c.muted}
                maxLength={500}
                onSubmitEditing={send}
                returnKeyType="send"
                style={[styles.input, { color: c.ink, backgroundColor: c.chip }]}
              />
              <Button
                label={t(locale, 'askSend')}
                onPress={send}
                disabled={busy || question.trim().length < 2}
              />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius,
    padding: space.m,
    marginTop: space.l,
  },
  title: { fontSize: 16, fontWeight: '700' },
  panel: { gap: space.s, marginTop: space.s },
  bubble: { padding: 10, borderRadius: radius, maxWidth: '90%' },
  input: { padding: 12, borderRadius: radius, fontSize: 16 },
});

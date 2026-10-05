'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { ChatResponse } from '@nm/contracts';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { api, ApiError } from '@/lib/client-api';
import { useViewer } from '../ViewerProvider';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  refused?: boolean;
}

/** "Ask this article" — answers only from this article's text (signed-in readers). */
export function ArticleChat({ articleId, locale }: { articleId: string; locale: Locale }) {
  const t = getMessages(locale).chat;
  const viewer = useViewer();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns([...turns, { role: 'user', content: q }]);
    setQuestion('');
    try {
      const answer = await api<ChatResponse>(`/api/v1/articles/${articleId}/chat`, {
        method: 'POST',
        body: { locale, question: q, history },
      });
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: answer.answer, refused: answer.refused },
      ]);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'generic';
      setError(t.errors[code as keyof typeof t.errors] ?? t.errors.generic);
      setTurns((prev) => prev.slice(0, -1));
      setQuestion(q);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat" aria-labelledby={`chat-${articleId}`}>
      <button
        className="chat__toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        id={`chat-${articleId}`}
      >
        {t.title}
      </button>
      {open ? (
        <div className="chat__panel">
          <p className="chat__intro">{t.intro}</p>
          {viewer.status === 'anonymous' ? (
            <p>
              <Link href={`/${locale}/account`}>{t.signIn}</Link>
            </p>
          ) : (
            <>
              <ol className="chat__log" aria-live="polite">
                {turns.map((turn, index) => (
                  <li
                    key={index}
                    className={`chat__turn chat__turn--${turn.role}${turn.refused ? ' chat__turn--refused' : ''}`}
                  >
                    {turn.content}
                  </li>
                ))}
                {busy ? <li className="chat__turn chat__turn--assistant">{t.thinking}</li> : null}
              </ol>
              {error ? (
                <p className="chat__error" role="alert">
                  {error}
                </p>
              ) : null}
              <form className="chat__form" onSubmit={submit}>
                <input
                  type="text"
                  value={question}
                  maxLength={500}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={t.placeholder}
                  aria-label={t.title}
                />
                <button
                  className="button"
                  type="submit"
                  disabled={busy || question.trim().length < 2}
                >
                  {t.ask}
                </button>
              </form>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

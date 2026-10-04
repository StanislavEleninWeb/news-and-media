import { z } from 'zod';
import { getConfig } from '@nm/core/config';
import { getDb } from '@nm/db';
import { createPasswordReset } from '@nm/services/auth/accounts';
import { sendMail } from '@nm/services/mail/mailer';
import { clientIp, json, parseBody, problem, rejectCrossSite } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const texts = {
  bg: {
    subject: 'Смяна на парола',
    body: (link: string) =>
      `Здравейте,\n\nПолучихме заявка за смяна на паролата ви. Отворете връзката в рамките на един час:\n\n${link}\n\nАко не сте поискали смяна, игнорирайте това писмо.`,
  },
  en: {
    subject: 'Reset your password',
    body: (link: string) =>
      `Hello,\n\nWe received a request to reset your password. Open this link within one hour:\n\n${link}\n\nIf you did not ask for this, you can ignore this e-mail.`,
  },
};

/** POST /api/v1/auth/password-reset {email} — always 202, whether or not the account exists. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  if (!rateLimit(`reset:${clientIp(request)}`, 5, 3_600_000)) return problem(429, 'rate_limited');
  const input = await parseBody(request, z.object({ email: z.string().max(254) }));
  if (input instanceof Response) return input;
  const reset = await createPasswordReset(getDb(), input.email);
  if (reset) {
    const locale = reset.user.locale;
    const link = `${getConfig().APP_URL.replace(/\/$/, '')}/${locale}/account/reset?token=${encodeURIComponent(reset.token)}`;
    await sendMail({
      to: reset.user.email,
      subject: texts[locale].subject,
      text: texts[locale].body(link),
    });
  }
  return json({ ok: true }, { status: 202 });
}

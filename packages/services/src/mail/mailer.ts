import * as nodemailer from 'nodemailer';
import { getConfig, type AppConfig } from '@nm/core/config';
import { getLogger } from '@nm/core/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  /** Operational mail to the team (alerts): not subject to NOTIFY_ALLOWLIST. */
  internal?: boolean;
}

export interface MailResult {
  delivered: boolean;
  reason?: 'not_allowlisted' | 'not_configured';
}

type Transport = { sendMail(message: object): Promise<unknown> };

let transport: Transport | null | undefined;
let testOutbox: (MailMessage & { from: string })[] | undefined;

/**
 * Outside production, only allowlisted addresses receive anything — a safety
 * net so dev and staging can never e-mail or notify real readers.
 */
export function isDeliveryAllowed(email: string, config: AppConfig = getConfig()): boolean {
  if (config.APP_ENV === 'production') return true;
  return config.NOTIFY_ALLOWLIST.includes(email.trim().toLowerCase());
}

function getTransport(config: AppConfig): Transport | null {
  if (transport === undefined) {
    transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  }
  return transport;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const config = getConfig();
  const logger = getLogger({ service: 'mail' });
  const from = config.MAIL_FROM;
  const allowed = message.internal || isDeliveryAllowed(message.to, config);
  if (testOutbox) {
    if (!allowed) return { delivered: false, reason: 'not_allowlisted' };
    testOutbox.push({ ...message, from });
    return { delivered: true };
  }
  if (!allowed) {
    logger.info(
      { to: message.to, subject: message.subject },
      'mail suppressed (not on NOTIFY_ALLOWLIST)',
    );
    return { delivered: false, reason: 'not_allowlisted' };
  }
  const smtp = getTransport(config);
  if (!smtp) {
    logger.warn(
      { to: message.to, subject: message.subject },
      'mail not sent: SMTP_URL is not configured',
    );
    return { delivered: false, reason: 'not_configured' };
  }
  await smtp.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { delivered: true };
}

/** Tests: capture messages instead of sending them. Returns the outbox array. */
export function useTestOutbox(): (MailMessage & { from: string })[] {
  testOutbox = [];
  return testOutbox;
}

export function resetMailer(): void {
  testOutbox = undefined;
  transport = undefined;
}

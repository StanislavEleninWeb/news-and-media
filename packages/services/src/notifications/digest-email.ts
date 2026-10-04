import type { ArticleCard } from '../content/contracts';
import type { Locale } from '@nm/db/schema';

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const copy = {
  bg: {
    subject: (date: string) => `Вашият дневен бюлетин · ${date}`,
    intro: 'Най-важното от последните 24 часа по вашите интереси:',
    read: 'Прочетете',
    footer: 'Получавате това писмо, защото сте включили дневния бюлетин.',
    manage: 'Настройки на известията',
  },
  en: {
    subject: (date: string) => `Your daily briefing · ${date}`,
    intro: 'The most important stories of the last 24 hours, picked for your interests:',
    read: 'Read',
    footer: 'You receive this e-mail because you turned on the daily briefing.',
    manage: 'Notification settings',
  },
};

/** Plain, table-based HTML that renders in every mail client, plus a text version. */
export function renderDigestEmail(options: {
  locale: Locale;
  siteName: string;
  siteUrl: string;
  dateLabel: string;
  items: ArticleCard[];
}): { subject: string; html: string; text: string; manageUrl: string } {
  const t = copy[options.locale];
  const manageUrl = `${options.siteUrl}/${options.locale}/account`;
  const rows = options.items
    .map(
      (item) => `
        <tr><td style="padding:16px 0;border-bottom:1px solid #e4e1da">
          <div style="font:700 11px/1.4 Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#b42318">${escape(item.topics[0]?.name ?? item.source.name)}</div>
          <a href="${escape(options.siteUrl + item.path)}" style="font:700 20px/1.25 Georgia,'Times New Roman',serif;color:#15171a;text-decoration:none">${escape(item.title)}</a>
          <p style="margin:6px 0 0;font:15px/1.5 Arial,sans-serif;color:#3d4148">${escape(item.tldr)}</p>
        </td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html lang="${options.locale}"><body style="margin:0;background:#fbfaf7">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfaf7"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
    <tr><td style="font:800 28px/1 Georgia,serif;color:#13233a;padding-bottom:4px">${escape(options.siteName)}<span style="color:#b42318">.</span></td></tr>
    <tr><td style="font:13px Arial,sans-serif;color:#6b7079;padding-bottom:16px">${escape(options.dateLabel)}</td></tr>
    <tr><td style="font:15px/1.5 Arial,sans-serif;color:#15171a;padding-bottom:8px">${escape(t.intro)}</td></tr>
    ${rows}
    <tr><td style="padding-top:20px;font:12px/1.5 Arial,sans-serif;color:#6b7079">${escape(t.footer)} <a href="${escape(manageUrl)}" style="color:#13233a">${escape(t.manage)}</a></td></tr>
  </table></td></tr></table></body></html>`;
  const text = [
    `${options.siteName} — ${options.dateLabel}`,
    '',
    t.intro,
    '',
    ...options.items.flatMap((item) => [
      `• ${item.title}`,
      `  ${item.tldr}`,
      `  ${options.siteUrl}${item.path}`,
      '',
    ]),
    `${t.footer} ${t.manage}: ${manageUrl}`,
  ].join('\n');
  return { subject: t.subject(options.dateLabel), html, text, manageUrl };
}

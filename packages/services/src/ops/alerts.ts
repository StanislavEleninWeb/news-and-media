import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import { getConfig } from '@nm/core/config';
import { getLogger } from '@nm/core/logger';
import type { Db } from '@nm/db';
import { articles, pipelineRuns, sources, systemState } from '@nm/db/schema';
import { monthToDateSpend } from '../ai/budget';
import { sendMail } from '../mail/mailer';

export interface Alert {
  /** Stable key used for throttling (one alert per key per window). */
  key: string;
  title: string;
  details: string;
  severity: 'warning' | 'critical';
}

export type AlertTransport = (alert: Alert) => Promise<void>;

/** Webhook (Slack/Discord/Mattermost-compatible) and/or e-mail, from configuration. */
export function createAlertTransport(): AlertTransport {
  const config = getConfig();
  return async (alert) => {
    const text = `${alert.severity === 'critical' ? '🔴' : '🟠'} [${config.APP_ENV}] ${alert.title}\n${alert.details}`;
    if (config.ALERT_WEBHOOK_URL) {
      await fetch(config.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(10_000),
      });
    }
    if (config.ALERT_EMAIL) {
      await sendMail({
        to: config.ALERT_EMAIL,
        subject: `[${config.APP_ENV}] ${alert.title}`,
        text,
        internal: true,
      });
    }
    if (!config.ALERT_WEBHOOK_URL && !config.ALERT_EMAIL) {
      getLogger({ service: 'alerts' }).warn(
        alert,
        'alert (no ALERT_WEBHOOK_URL / ALERT_EMAIL configured)',
      );
    }
  };
}

/** Sends an alert unless the same key fired within `throttleHours`. */
export async function raiseAlert(
  db: Db,
  transport: AlertTransport,
  alert: Alert,
  throttleHours = 6,
): Promise<boolean> {
  const key = `alert:${alert.key}`;
  const [last] = await db.select().from(systemState).where(eq(systemState.key, key));
  const lastAt = last ? Date.parse((last.value as { at: string }).at) : 0;
  if (Date.now() - lastAt < throttleHours * 3_600_000) return false;
  await transport(alert);
  const value = { at: new Date().toISOString(), title: alert.title };
  await db
    .insert(systemState)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemState.key, set: { value } });
  return true;
}

/**
 * Periodic health checks of the content pipeline. Returns the alerts that
 * apply right now; `raiseAlert` throttles repeats.
 */
export async function evaluatePipelineHealth(db: Db, now = new Date()): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const config = getConfig();

  const [lastIngest] = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.kind, 'ingest'))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  if (lastIngest?.status === 'failed') {
    alerts.push({
      key: 'ingest-failed',
      severity: 'critical',
      title: 'Ingestion run failed — every due source errored',
      details: (lastIngest.errorSummary ?? '').slice(0, 1500),
    });
  }

  const [activeSources] = await db
    .select({ n: count() })
    .from(sources)
    .where(eq(sources.isActive, true));
  const [recent] = await db
    .select({ n: count() })
    .from(articles)
    .where(gt(articles.ingestedAt, new Date(now.getTime() - 24 * 3_600_000)));
  if ((activeSources?.n ?? 0) > 0 && (recent?.n ?? 0) === 0) {
    alerts.push({
      key: 'no-new-articles',
      severity: 'critical',
      title: 'No new articles in the last 24 hours',
      details: `${activeSources?.n} active sources, 0 articles ingested. Check the worker logs and Admin → Sources.`,
    });
  }

  const [budgetRun] = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.kind, 'process'),
        gt(pipelineRuns.startedAt, new Date(now.getTime() - 3_600_000)),
        sql`${pipelineRuns.errorSummary} ilike '%budget%'`,
      ),
    )
    .limit(1);
  const spent = await monthToDateSpend(db, now);
  if (budgetRun) {
    alerts.push({
      key: 'llm-budget-exhausted',
      severity: 'critical',
      title: 'AI processing stopped: monthly LLM budget reached',
      details: `Spent $${spent.toFixed(2)} of $${config.LLM_MONTHLY_BUDGET_USD}. Raise LLM_MONTHLY_BUDGET_USD or wait for the new month.`,
    });
  } else if (spent >= config.LLM_MONTHLY_BUDGET_USD * 0.8) {
    alerts.push({
      key: 'llm-budget-80',
      severity: 'warning',
      title: 'LLM spend passed 80% of the monthly budget',
      details: `Spent $${spent.toFixed(2)} of $${config.LLM_MONTHLY_BUDGET_USD}.`,
    });
  }

  const [stuck] = await db
    .select({ n: count() })
    .from(articles)
    .where(
      and(
        eq(articles.status, 'ingested'),
        sql`${articles.ingestedAt} < ${new Date(now.getTime() - 6 * 3_600_000).toISOString()}::timestamptz`,
      ),
    );
  if ((stuck?.n ?? 0) >= 20) {
    alerts.push({
      key: 'ai-queue-stuck',
      severity: 'warning',
      title: 'AI processing is falling behind',
      details: `${stuck?.n} articles have waited more than 6 hours. Check the LLM API key, the provider status and the worker logs.`,
    });
  }
  return alerts;
}

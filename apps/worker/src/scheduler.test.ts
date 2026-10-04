import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scheduler } from './scheduler';

const logger = pino({ level: 'silent' });

describe('Scheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('skips automatic tasks when the scheduler is disabled', async () => {
    const scheduler = new Scheduler(logger, false);
    scheduler.register({ name: 'ingest', everyMs: 1000, automatic: true, run: async () => {} });
    scheduler.register({ name: 'jobs', everyMs: 1000, automatic: false, run: async () => {} });
    expect(scheduler.taskNames).toEqual(['jobs']);
    await scheduler.stop();
  });

  it('never overlaps runs of the same task', async () => {
    vi.useFakeTimers();
    const scheduler = new Scheduler(logger, true);
    let concurrent = 0;
    let maxConcurrent = 0;
    let runs = 0;
    scheduler.register({
      name: 'slow',
      everyMs: 100,
      automatic: true,
      run: async () => {
        runs += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 350));
        concurrent -= 1;
      },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const stopping = scheduler.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    await stopping;
    expect(runs).toBeGreaterThan(1);
    expect(maxConcurrent).toBe(1);
  });
});

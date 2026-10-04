import type { Logger } from 'pino';

export interface ScheduledTask {
  name: string;
  /** How often the task runs, in milliseconds. */
  everyMs: number;
  /** Automatic tasks only run when SCHEDULER_ENABLED is true; queue consumers always run. */
  automatic: boolean;
  run: (signal: AbortSignal) => Promise<void>;
}

/**
 * Minimal in-process scheduler. Each task runs on its own interval and never
 * overlaps with itself; a failing run is logged and retried on the next tick.
 * The work itself is driven by database state (e.g. sources due for fetching),
 * so restarting the worker never loses or duplicates work.
 */
export class Scheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly controller = new AbortController();

  constructor(
    private readonly logger: Logger,
    private readonly schedulerEnabled: boolean,
    private readonly onError?: (task: string, error: unknown) => void,
  ) {}

  register(task: ScheduledTask): void {
    if (task.automatic && !this.schedulerEnabled) {
      this.logger.info({ task: task.name }, 'automatic task disabled (SCHEDULER_ENABLED=false)');
      return;
    }
    const tick = () => {
      if (this.running.has(task.name) || this.controller.signal.aborted) return;
      const startedAt = Date.now();
      const promise = task
        .run(this.controller.signal)
        .catch((error: unknown) => {
          this.logger.error({ task: task.name, err: error }, 'scheduled task failed');
          this.onError?.(task.name, error);
        })
        .finally(() => {
          this.running.delete(task.name);
          this.logger.debug({ task: task.name, ms: Date.now() - startedAt }, 'task finished');
        });
      this.running.set(task.name, promise);
    };
    this.timers.set(task.name, setInterval(tick, task.everyMs));
    // First run shortly after start-up rather than waiting a whole interval.
    setTimeout(tick, 1_000).unref();
    this.logger.info({ task: task.name, everyMs: task.everyMs }, 'task registered');
  }

  /** Stops scheduling and waits for in-flight runs to finish. */
  async stop(): Promise<void> {
    this.controller.abort();
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    await Promise.allSettled([...this.running.values()]);
  }

  get taskNames(): string[] {
    return [...this.timers.keys()];
  }
}

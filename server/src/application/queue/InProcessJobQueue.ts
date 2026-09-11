import type { JobHandler, JobQueue } from './JobQueue.js';

export interface InProcessJobQueueOptions {
  readonly concurrency?: number;
  readonly onError?: (error: unknown) => void;
}

/**
 * An in-memory queue with bounded concurrency.
 *
 * Honest about what it is: jobs live in this process, so a restart loses
 * anything queued. That is an acceptable trade for a practice platform where
 * the submission itself is already durable: a lost job leaves the attempt in
 * `queued`, and the learner (or a sweep) can re-run it without losing work.
 * The alternative, a durable broker, is a dependency the MVP does not earn.
 */
export class InProcessJobQueue<T> implements JobQueue<T> {
  private readonly pending: T[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private handler: JobHandler<T> | null = null;
  private inFlight = 0;
  private stopped = false;
  private idleWaiters: Array<() => void> = [];

  private readonly concurrency: number;
  private readonly onError: (error: unknown) => void;

  constructor(options: InProcessJobQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.onError = options.onError ?? (() => {});
  }

  process(handler: JobHandler<T>): void {
    this.handler = handler;
    this.pump();
  }

  async enqueue(job: T, delayMs = 0): Promise<void> {
    if (this.stopped) return;
    if (delayMs > 0) {
      // Counted as in-flight so `drain()` waits for delayed retries too.
      this.inFlight += 1;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.inFlight -= 1;
        this.pending.push(job);
        this.pump();
      }, delayMs);
      // Never hold the process open for a retry that no one is waiting on.
      timer.unref?.();
      this.timers.add(timer);
      return;
    }
    this.pending.push(job);
    this.pump();
  }

  size(): number {
    return this.pending.length + this.inFlight;
  }

  async drain(): Promise<void> {
    if (this.size() === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.pending.length = 0;
    await this.drain();
  }

  private pump(): void {
    if (!this.handler) return;

    while (this.inFlight < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift() as T;
      this.inFlight += 1;
      void this.handler(job)
        .catch((error) => this.onError(error))
        .finally(() => {
          this.inFlight -= 1;
          this.pump();
          this.settleIfIdle();
        });
    }
    this.settleIfIdle();
  }

  private settleIfIdle(): void {
    if (this.size() > 0 || this.idleWaiters.length === 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

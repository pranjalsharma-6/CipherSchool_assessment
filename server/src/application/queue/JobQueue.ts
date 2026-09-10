/**
 * A minimal asynchronous work queue.
 *
 * Evaluation is slow and fallible, so it must not run inside the request that
 * submits an attempt. This interface is the seam that keeps that decision from
 * dictating the deployment: the MVP ships an in-process implementation because
 * a monolith is the right size for the problem, and moving to BullMQ or Kafka
 * later means one new adapter and one line in the container — not a change to
 * the worker, the services, or the attempt lifecycle.
 */
export interface JobQueue<T> {
  /** `delayMs` supports retry backoff. */
  enqueue(job: T, delayMs?: number): Promise<void>;
  /** Registers the single consumer. Must be called before jobs are enqueued. */
  process(handler: JobHandler<T>): void;
  /** Resolves once the queue is empty and nothing is in flight (tests, shutdown). */
  drain(): Promise<void>;
  stop(): Promise<void>;
  size(): number;
}

export type JobHandler<T> = (job: T) => Promise<void>;

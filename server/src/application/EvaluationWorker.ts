import type { AttemptId, Clock } from '../domain/shared/ids.js';
import type { EvaluationPipeline } from '../evaluation/EvaluationPipeline.js';
import type { SubmissionNormalizerRegistry } from '../evaluation/normalizers/SubmissionNormalizer.js';
import type { AttemptRepository, ProblemRepository } from './ports.js';
import type { JobQueue } from './queue/JobQueue.js';
import type { AttemptService } from './AttemptService.js';

export interface EvaluationJob {
  readonly attemptId: AttemptId;
}

export interface EvaluationWorkerOptions {
  /** Base delay for the exponential backoff between retries. */
  readonly retryBaseMs?: number;
  readonly logger?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Consumes evaluation jobs and moves the attempt through its lifecycle.
 *
 * The failure story lives here, and it has three levels:
 *   1. an evaluator that fails but is optional: the pipeline degrades and the
 *      attempt still completes with a deterministic-only review;
 *   2. a retryable failure of the whole run: re-queued with exponential
 *      backoff, up to the attempt's run limit;
 *   3. anything else, or the last retry: the attempt lands in `failed` with
 *      the reason kept, and the learner can re-run it from the UI.
 *
 * At no point is the learner's submission lost or the error swallowed.
 */
export class EvaluationWorker {
  private readonly retryBaseMs: number;
  private readonly log: (message: string, meta?: Record<string, unknown>) => void;

  constructor(
    private readonly queue: JobQueue<EvaluationJob>,
    private readonly attempts: AttemptRepository,
    private readonly problems: ProblemRepository,
    private readonly normalizers: SubmissionNormalizerRegistry,
    private readonly pipeline: EvaluationPipeline,
    private readonly attemptService: AttemptService,
    private readonly clock: Clock,
    options: EvaluationWorkerOptions = {},
  ) {
    this.retryBaseMs = options.retryBaseMs ?? 1000;
    this.log = options.logger ?? (() => {});
  }

  start(): void {
    this.queue.process((job) => this.handle(job));
  }

  private async handle(job: EvaluationJob): Promise<void> {
    const attempt = await this.attempts.findById(job.attemptId);
    if (!attempt) {
      this.log('evaluation.attempt_missing', { attemptId: job.attemptId });
      return;
    }
    // A restart can redeliver a job for an attempt that already finished.
    if (attempt.status !== 'queued') {
      this.log('evaluation.skipped', { attemptId: attempt.id, status: attempt.status });
      return;
    }

    attempt.markEvaluating(this.clock.now());
    await this.attempts.save(attempt);

    try {
      const problem = await this.problems.findById(attempt.problemId);
      if (!problem) throw new Error(`Problem '${attempt.problemId}' no longer exists`);

      const submission = attempt.requireSubmission();
      const evaluation = await this.pipeline.run({
        problem,
        submission,
        design: this.normalizers.normalize(submission),
        attemptNumber: attempt.attemptNumber,
        previousScore: await this.attemptService.previousScore(
          attempt.learnerId,
          attempt.problemId,
          attempt.id,
        ),
      });

      attempt.completeEvaluation(evaluation, this.clock.now());
      await this.attempts.save(attempt);
      this.log('evaluation.completed', {
        attemptId: attempt.id,
        score: evaluation.overallScore,
        degraded: evaluation.degraded,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryable(error);

      attempt.failEvaluation(message, retryable, this.clock.now());
      await this.attempts.save(attempt);

      if (attempt.status === 'queued') {
        // 1s, 2s, 4s, enough to ride out a rate limit without making the
        // learner watch a spinner for a minute.
        const delay = this.retryBaseMs * 2 ** (attempt.evaluationRuns - 1);
        this.log('evaluation.retrying', { attemptId: attempt.id, delay, reason: message });
        await this.queue.enqueue({ attemptId: attempt.id }, delay);
      } else {
        this.log('evaluation.failed', { attemptId: attempt.id, reason: message });
      }
    }
  }
}

function isRetryable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    (error as { retryable: unknown }).retryable === true
  );
}

import { Attempt } from '../domain/attempt/Attempt.js';
import type { Submission } from '../domain/attempt/Submission.js';
import { NotFoundError, ValidationError } from '../domain/shared/errors.js';
import {
  newAttemptId,
  type AttemptId,
  type Clock,
  type LearnerId,
  type ProblemId,
} from '../domain/shared/ids.js';
import type { Problem } from '../domain/problem/Problem.js';
import type { AttemptRepository, ProblemRepository } from './ports.js';
import type { JobQueue } from './queue/JobQueue.js';
import type { EvaluationJob } from './EvaluationWorker.js';

/**
 * Drives the practice loop: start → save → submit → (queued) → review → repeat.
 *
 * The service is deliberately thin. It loads aggregates, calls one method on
 * them, saves, and enqueues — every rule about what is legal when lives on
 * {@link Attempt}, so there is no second, contradictory copy of the lifecycle
 * here or in the controllers.
 */
export class AttemptService {
  constructor(
    private readonly attempts: AttemptRepository,
    private readonly problems: ProblemRepository,
    private readonly queue: JobQueue<EvaluationJob>,
    private readonly clock: Clock,
  ) {}

  async start(learnerId: LearnerId, problemIdOrSlug: string): Promise<Attempt> {
    const problem = await this.resolveProblem(problemIdOrSlug);
    const previous = await this.attempts.countByLearnerAndProblem(learnerId, problem.id);

    const attempt = Attempt.start({
      id: newAttemptId(),
      problemId: problem.id,
      learnerId,
      attemptNumber: previous + 1,
      now: this.clock.now(),
    });

    await this.attempts.save(attempt);
    return attempt;
  }

  /** Autosave. Idempotent, and never touches the attempt's status. */
  async saveDraft(id: AttemptId, learnerId: LearnerId, submission: Submission): Promise<Attempt> {
    const attempt = await this.require(id, learnerId);
    attempt.saveDraft(submission, this.clock.now());
    await this.attempts.save(attempt);
    return attempt;
  }

  /**
   * Hands the design in and returns immediately.
   *
   * The response is the attempt in `queued` — not a score — because evaluation
   * takes seconds and the learner should see their submission land right away.
   * The client polls the attempt until it leaves a pending status.
   */
  async submit(id: AttemptId, learnerId: LearnerId, submission: Submission): Promise<Attempt> {
    const attempt = await this.require(id, learnerId);
    attempt.submit(submission, this.clock.now());
    await this.attempts.save(attempt);
    await this.queue.enqueue({ attemptId: attempt.id });
    return attempt;
  }

  /** Re-runs a failed evaluation without the learner retyping anything. */
  async retryEvaluation(id: AttemptId, learnerId: LearnerId): Promise<Attempt> {
    const attempt = await this.require(id, learnerId);
    if (attempt.status !== 'failed') {
      throw new ValidationError(
        `Only a failed attempt can be re-evaluated; this one is '${attempt.status}'.`,
      );
    }
    attempt.retryEvaluation(this.clock.now());
    await this.attempts.save(attempt);
    await this.queue.enqueue({ attemptId: attempt.id });
    return attempt;
  }

  async get(id: AttemptId, learnerId: LearnerId): Promise<Attempt> {
    return this.require(id, learnerId);
  }

  async history(learnerId: LearnerId, problemIdOrSlug?: string): Promise<readonly Attempt[]> {
    if (!problemIdOrSlug) return this.attempts.findByLearner(learnerId);
    const problem = await this.resolveProblem(problemIdOrSlug);
    return this.attempts.findByLearnerAndProblem(learnerId, problem.id);
  }

  /**
   * The score of the learner's most recent evaluated attempt at this problem —
   * used to tell the reviewer what "improved" would mean for this submission.
   */
  async previousScore(
    learnerId: LearnerId,
    problemId: ProblemId,
    excluding: AttemptId,
  ): Promise<number | null> {
    const attempts = await this.attempts.findByLearnerAndProblem(learnerId, problemId);
    const evaluated = attempts
      .filter((a) => a.id !== excluding && a.evaluation !== null)
      .sort((a, b) => (b.evaluatedAt?.getTime() ?? 0) - (a.evaluatedAt?.getTime() ?? 0));
    return evaluated[0]?.evaluation?.overallScore ?? null;
  }

  private async require(id: AttemptId, learnerId: LearnerId): Promise<Attempt> {
    const attempt = await this.attempts.findById(id);
    // A mismatched learner is reported as "not found" rather than "forbidden":
    // whether another learner's attempt exists is not this caller's business.
    if (!attempt || attempt.learnerId !== learnerId) throw new NotFoundError('Attempt', id);
    return attempt;
  }

  private async resolveProblem(idOrSlug: string): Promise<Problem> {
    const problem =
      (await this.problems.findBySlug(idOrSlug)) ??
      (await this.problems.findById(idOrSlug as ProblemId));
    if (!problem) throw new NotFoundError('Problem', idOrSlug);
    return problem;
  }
}

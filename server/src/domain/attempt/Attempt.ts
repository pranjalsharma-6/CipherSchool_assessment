import { IllegalStateTransitionError, ValidationError } from '../shared/errors.js';
import type { AttemptId, LearnerId, ProblemId } from '../shared/ids.js';
import type { Evaluation } from '../evaluation/Evaluation.js';
import { assertSubmittable, type Submission } from './Submission.js';
import { canTransition, type AttemptStatus } from './AttemptStatus.js';

/** An append-only record of what happened to this attempt, shown as a timeline. */
export interface AttemptEvent {
  readonly at: Date;
  readonly type:
    | 'created'
    | 'draft_saved'
    | 'submitted'
    | 'evaluation_started'
    | 'evaluation_completed'
    | 'evaluation_retried'
    | 'evaluation_failed';
  readonly detail?: string;
}

export interface AttemptProps {
  readonly id: AttemptId;
  readonly problemId: ProblemId;
  readonly learnerId: LearnerId;
  readonly attemptNumber: number;
  readonly status: AttemptStatus;
  readonly submission: Submission | null;
  readonly evaluation: Evaluation | null;
  readonly events: readonly AttemptEvent[];
  readonly evaluationRuns: number;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly submittedAt: Date | null;
  readonly evaluatedAt: Date | null;
}

/** How many times the pipeline may run before an attempt is marked failed. */
export const MAX_EVALUATION_RUNS = 3;

/**
 * The aggregate root of the practice loop.
 *
 * Every state change goes through a method here, and every method checks the
 * transition table first. Nothing outside this class assigns to `status`, so
 * "can an evaluated attempt be resubmitted?" has exactly one answer, in one
 * file, rather than being an emergent property of the services.
 */
export class Attempt {
  readonly id: AttemptId;
  readonly problemId: ProblemId;
  readonly learnerId: LearnerId;
  readonly attemptNumber: number;
  readonly createdAt: Date;

  private _status: AttemptStatus;
  private _submission: Submission | null;
  private _evaluation: Evaluation | null;
  private _events: AttemptEvent[];
  private _evaluationRuns: number;
  private _failureReason: string | null;
  private _updatedAt: Date;
  private _submittedAt: Date | null;
  private _evaluatedAt: Date | null;

  constructor(props: AttemptProps) {
    this.id = props.id;
    this.problemId = props.problemId;
    this.learnerId = props.learnerId;
    this.attemptNumber = props.attemptNumber;
    this.createdAt = props.createdAt;
    this._status = props.status;
    this._submission = props.submission;
    this._evaluation = props.evaluation;
    this._events = [...props.events];
    this._evaluationRuns = props.evaluationRuns;
    this._failureReason = props.failureReason;
    this._updatedAt = props.updatedAt;
    this._submittedAt = props.submittedAt;
    this._evaluatedAt = props.evaluatedAt;
  }

  static start(params: {
    id: AttemptId;
    problemId: ProblemId;
    learnerId: LearnerId;
    attemptNumber: number;
    now: Date;
  }): Attempt {
    return new Attempt({
      id: params.id,
      problemId: params.problemId,
      learnerId: params.learnerId,
      attemptNumber: params.attemptNumber,
      status: 'draft',
      submission: null,
      evaluation: null,
      events: [{ at: params.now, type: 'created' }],
      evaluationRuns: 0,
      failureReason: null,
      createdAt: params.now,
      updatedAt: params.now,
      submittedAt: null,
      evaluatedAt: null,
    });
  }

  get status(): AttemptStatus {
    return this._status;
  }
  get submission(): Submission | null {
    return this._submission;
  }
  get evaluation(): Evaluation | null {
    return this._evaluation;
  }
  get events(): readonly AttemptEvent[] {
    return this._events;
  }
  get evaluationRuns(): number {
    return this._evaluationRuns;
  }
  get failureReason(): string | null {
    return this._failureReason;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
  get submittedAt(): Date | null {
    return this._submittedAt;
  }
  get evaluatedAt(): Date | null {
    return this._evaluatedAt;
  }

  /** Autosave. Only a draft is editable — a submitted design is a fixed record. */
  saveDraft(submission: Submission, now: Date): void {
    if (this._status !== 'draft') {
      throw new ValidationError(
        `Attempt ${this.id} is '${this._status}' and can no longer be edited. Start a new attempt to iterate.`,
      );
    }
    this._submission = submission;
    this.record({ at: now, type: 'draft_saved' }, now);
  }

  /** Hand the design in. Validates substance, then hands off to the queue. */
  submit(submission: Submission, now: Date): void {
    // Validate before transitioning: a rejected submission must leave the
    // attempt exactly as it was, still editable, with nothing typed lost.
    assertSubmittable(submission);
    this.transitionTo('queued');
    this._submission = submission;
    this._submittedAt = now;
    this._failureReason = null;
    this.record({ at: now, type: 'submitted', detail: `format=${submission.format}` }, now);
  }

  markEvaluating(now: Date): void {
    this.transitionTo('evaluating');
    this._evaluationRuns += 1;
    this.record(
      { at: now, type: 'evaluation_started', detail: `run ${this._evaluationRuns}` },
      now,
    );
  }

  completeEvaluation(evaluation: Evaluation, now: Date): void {
    this.transitionTo('evaluated');
    this._evaluation = evaluation;
    this._evaluatedAt = now;
    this._failureReason = null;
    this.record(
      {
        at: now,
        type: 'evaluation_completed',
        detail: evaluation.degraded
          ? `scored ${evaluation.overallScore} (deterministic only)`
          : `scored ${evaluation.overallScore}`,
      },
      now,
    );
  }

  /**
   * Evaluation broke. Retryable errors go back on the queue while runs remain;
   * anything else — or the last run — parks the attempt in `failed`, where the
   * learner can re-run it by hand without losing a word of what they wrote.
   */
  failEvaluation(reason: string, retryable: boolean, now: Date): void {
    const hasRunsLeft = this._evaluationRuns < MAX_EVALUATION_RUNS;
    if (retryable && hasRunsLeft) {
      this.transitionTo('queued');
      this._failureReason = reason;
      this.record({ at: now, type: 'evaluation_retried', detail: reason }, now);
      return;
    }
    this.transitionTo('failed');
    this._failureReason = reason;
    this.record({ at: now, type: 'evaluation_failed', detail: reason }, now);
  }

  /** Learner-triggered re-run of a failed evaluation. */
  retryEvaluation(now: Date): void {
    this.transitionTo('queued');
    this._evaluationRuns = 0;
    this.record({ at: now, type: 'evaluation_retried', detail: 'requested by learner' }, now);
  }

  requireSubmission(): Submission {
    if (!this._submission) {
      throw new ValidationError(`Attempt ${this.id} has no submission to evaluate`);
    }
    return this._submission;
  }

  toProps(): AttemptProps {
    return {
      id: this.id,
      problemId: this.problemId,
      learnerId: this.learnerId,
      attemptNumber: this.attemptNumber,
      status: this._status,
      submission: this._submission,
      evaluation: this._evaluation,
      events: this._events,
      evaluationRuns: this._evaluationRuns,
      failureReason: this._failureReason,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
      submittedAt: this._submittedAt,
      evaluatedAt: this._evaluatedAt,
    };
  }

  private transitionTo(to: AttemptStatus): void {
    if (!canTransition(this._status, to)) {
      throw new IllegalStateTransitionError('Attempt', this._status, to);
    }
    this._status = to;
  }

  private record(event: AttemptEvent, now: Date): void {
    this._events.push(event);
    this._updatedAt = now;
  }
}

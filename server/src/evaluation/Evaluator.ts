import type { Problem } from '../domain/problem/Problem.js';
import type { RubricDimensionId } from '../domain/problem/Rubric.js';
import type { DesignModel } from '../domain/attempt/DesignModel.js';
import type { Submission } from '../domain/attempt/Submission.js';
import type {
  FeedbackItem,
  FeedbackSource,
  RequirementCoverage,
} from '../domain/evaluation/Evaluation.js';

/** Everything an evaluator is allowed to look at. */
export interface EvaluationContext {
  readonly problem: Problem;
  readonly submission: Submission;
  readonly design: DesignModel;
  readonly attemptNumber: number;
  /** Score of the learner's previous evaluated attempt, when there is one. */
  readonly previousScore: number | null;
}

export interface DimensionAssessment {
  readonly dimension: RubricDimensionId;
  /** 0-100. */
  readonly score: number;
  readonly rationale: string;
}

/** One evaluator's opinion. The aggregator, not the evaluator, decides weight. */
export interface EvaluationContribution {
  readonly source: FeedbackSource;
  readonly dimensions: readonly DimensionAssessment[];
  readonly feedback: readonly FeedbackItem[];
  readonly requirementCoverage?: readonly RequirementCoverage[];
  readonly summary?: string;
}

/**
 * A source of judgement about a design.
 *
 * The pipeline holds a list of these and knows nothing about what is inside
 * them, which is what lets a rule engine and a language model sit side by side,
 * and what would let a third kind (a peer-review queue, a static analyser over
 * submitted code) be added without the scoring code changing.
 */
export interface Evaluator {
  readonly name: string;
  readonly version: string;
  readonly source: FeedbackSource;
  /** Cheap evaluators may decline problems or formats they cannot judge. */
  supports?(context: EvaluationContext): boolean;
  evaluate(context: EvaluationContext): Promise<EvaluationContribution>;
}

/** Signals to the pipeline that another run might succeed. */
export class RetryableEvaluationError extends Error {
  readonly retryable = true;

  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'RetryableEvaluationError';
  }
}

export const clampScore = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;

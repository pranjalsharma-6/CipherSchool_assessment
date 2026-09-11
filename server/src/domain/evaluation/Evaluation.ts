import type { RubricDimensionId } from '../problem/Rubric.js';

/** Which evaluator produced a piece of feedback. Always shown to the learner. */
export type FeedbackSource = 'deterministic' | 'llm';

export type FeedbackKind = 'strength' | 'gap' | 'suggestion' | 'pitfall' | 'question';

/**
 * One piece of feedback.
 *
 * `source` is not a debugging field, it is on screen. A learner who is told
 * "nothing owns pricing" should be able to see that a rule found that, while
 * "your Vehicle class is doing two jobs" came from a model and is an opinion.
 * Labelling which is which is what keeps the feedback trustworthy when the
 * model is occasionally wrong.
 */
export interface FeedbackItem {
  readonly id: string;
  readonly kind: FeedbackKind;
  readonly dimension: RubricDimensionId;
  readonly title: string;
  readonly detail: string;
  readonly source: FeedbackSource;
  /** Present when the item is tied to a specific requirement. */
  readonly requirementId?: string;
}

export interface RequirementCoverage {
  readonly requirementId: string;
  readonly text: string;
  readonly kind: 'stated' | 'implied';
  readonly covered: boolean;
  /** The learner's own words that matched, so the verdict is auditable. */
  readonly matchedSignals: readonly string[];
}

export interface DimensionScore {
  readonly dimension: RubricDimensionId;
  readonly label: string;
  /** 0-100, the blend actually used for the overall score. */
  readonly score: number;
  readonly weight: number;
  readonly deterministicScore: number | null;
  readonly llmScore: number | null;
  readonly rationale: string;
}

/**
 * The result of evaluating one attempt.
 *
 * `degraded` matters: when the LLM is unavailable the platform still returns a
 * real, useful, deterministic result rather than an error page, and says so,
 * so the learner knows the qualitative half is missing and can re-run it.
 */
export interface Evaluation {
  readonly overallScore: number;
  readonly dimensionScores: readonly DimensionScore[];
  readonly feedback: readonly FeedbackItem[];
  readonly requirementCoverage: readonly RequirementCoverage[];
  readonly summary: string;
  readonly degraded: boolean;
  readonly degradedReason: string | null;
  readonly evaluators: readonly EvaluatorRun[];
  readonly generatedAt: Date;
}

/** Provenance for one evaluator in the pipeline: surfaced in the UI. */
export interface EvaluatorRun {
  readonly name: string;
  readonly version: string;
  readonly status: 'ok' | 'failed' | 'skipped';
  readonly durationMs: number;
  readonly error?: string;
}

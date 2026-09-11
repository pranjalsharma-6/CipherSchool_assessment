import type { RubricDimensionId } from '../../domain/problem/Rubric.js';
import type { FeedbackItem, RequirementCoverage } from '../../domain/evaluation/Evaluation.js';
import type { EvaluationContext } from '../Evaluator.js';

export interface CheckResult {
  /** 0-100 for this check's dimension, or null to abstain. */
  readonly score: number | null;
  readonly rationale: string;
  readonly feedback: readonly Omit<FeedbackItem, 'source'>[];
  readonly requirementCoverage?: readonly RequirementCoverage[];
}

/**
 * One reproducible rule about a design.
 *
 * Checks are the deterministic half of the evaluation story: same submission in,
 * same verdict out, every time, with the matched evidence attached. They are
 * small and independent so the rule set can grow without any one file growing,
 * and so a check that turns out to be a bad idea can be deleted on its own.
 */
export interface DesignCheck {
  readonly id: string;
  readonly dimension: RubricDimensionId;
  run(context: EvaluationContext): CheckResult;
}

export const NO_FEEDBACK: readonly Omit<FeedbackItem, 'source'>[] = [];

/**
 * Word-boundary-aware search over the flattened design text.
 *
 * Terms of six characters or more may carry a short inflectional suffix, so
 * `concurrent` matches "concurrently" and `reassign` matches "reassigned",
 * learners write the inflected form far more often than the stem. Shorter
 * terms stay strict, because a three-character allowance on a word like `full`
 * would start matching "fully" and "fulfilled".
 */
export function mentions(haystack: string, needle: string): boolean {
  const term = needle.toLowerCase().trim();
  if (!term) return false;
  if (/[^a-z0-9 ]/.test(term)) return haystack.includes(term);

  const body = term.replace(/\s+/g, '\\s*');
  const suffix = term.length >= 6 ? '\\w{0,3}' : 's?';
  return new RegExp(`\\b${body}${suffix}\\b`, 'i').test(haystack);
}

/** Returns every term from `terms` that appears in `haystack`. */
export function matchedTerms(haystack: string, terms: readonly string[]): string[] {
  return terms.filter((term) => mentions(haystack, term));
}

/** Linear ratio → score, with a floor so a partial answer is never a zero. */
export function ratioToScore(matched: number, total: number, floor = 0): number {
  if (total === 0) return 100;
  return Math.round(floor + (100 - floor) * (matched / total));
}

import type { EvaluationContext } from '../../Evaluator.js';
import { clampScore } from '../../Evaluator.js';
import { matchedTerms, type CheckResult, type DesignCheck } from '../DesignCheck.js';

/** Vocabulary that shows the learner thought past the happy path. */
const FAILURE_SIGNALS = [
  'invalid', 'error', 'exception', 'fail', 'reject', 'retry', 'timeout',
  'not found', 'unavailable', 'full', 'empty', 'expired', 'duplicate', 'rollback',
];

const CONCURRENCY_SIGNALS = [
  'concurrent', 'concurrency', 'thread', 'thread-safe', 'lock', 'mutex',
  'synchronized', 'atomic', 'race', 'optimistic', 'pessimistic', 'transaction',
  'idempotent', 'version',
];

/**
 * Did the design think about what goes wrong?
 *
 * Scored separately from requirement coverage because it is the axis learners
 * most reliably skip: a parking-lot design that never mentions a full lot or two
 * cars racing for the last slot is incomplete no matter how tidy its classes are.
 */
export class EdgeCaseCheck implements DesignCheck {
  readonly id = 'edge-case-awareness';
  readonly dimension = 'edge_cases' as const;

  run({ design, problem }: EvaluationContext): CheckResult {
    const failures = matchedTerms(design.searchText, FAILURE_SIGNALS);
    const concurrency = matchedTerms(design.searchText, CONCURRENCY_SIGNALS);
    const concurrencyMatters = problem.tags.includes('concurrency');

    const feedback = [];
    let score = 20;
    score += Math.min(45, 12 * failures.length);
    score += Math.min(35, 15 * concurrency.length);

    if (failures.length === 0) {
      feedback.push({
        id: 'no-failure-paths',
        kind: 'gap' as const,
        dimension: this.dimension,
        title: 'Only the happy path is described',
        detail:
          'Nothing in the design mentions what happens when an operation cannot succeed. Pick your two or three riskiest operations and say what each returns or throws when the precondition does not hold.',
      });
    } else {
      feedback.push({
        id: 'failure-paths',
        kind: 'strength' as const,
        dimension: this.dimension,
        title: 'Failure cases are part of the design',
        detail: `Detected handling around: ${failures.slice(0, 6).join(', ')}.`,
      });
    }

    if (concurrencyMatters && concurrency.length === 0) {
      score -= 15;
      feedback.push({
        id: 'no-concurrency',
        kind: 'gap' as const,
        dimension: this.dimension,
        title: 'Concurrent access is not addressed',
        detail:
          'This problem has a shared resource that two requests can reach at the same moment. Name where the contention is and how you resolve it — a lock, an atomic reservation, or an optimistic version check are all defensible answers; silence is not.',
      });
    } else if (concurrency.length > 0) {
      feedback.push({
        id: 'concurrency-considered',
        kind: 'strength' as const,
        dimension: this.dimension,
        title: 'Concurrency is considered explicitly',
        detail: `Detected: ${concurrency.slice(0, 6).join(', ')}.`,
      });
    }

    return {
      score: clampScore(score),
      rationale: `${failures.length} failure-path signals, ${concurrency.length} concurrency signals.`,
      feedback,
    };
  }
}

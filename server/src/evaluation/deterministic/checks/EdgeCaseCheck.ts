import type { FeedbackItem } from '../../../domain/evaluation/Evaluation.js';
import type { EvaluationContext } from '../../Evaluator.js';
import { clampScore } from '../../Evaluator.js';
import { matchedTerms, type CheckResult, type DesignCheck } from '../DesignCheck.js';

/** Generic vocabulary that shows the learner thought past the happy path. */
const FAILURE_SIGNALS = [
  'invalid', 'error', 'exception', 'fail', 'reject', 'retry', 'timeout',
  'not found', 'unavailable', 'full', 'empty', 'expired', 'duplicate', 'rollback',
  'guard', 'precondition', 'validate',
];

const CONCURRENCY_SIGNALS = [
  'concurrent', 'thread', 'thread-safe', 'lock', 'mutex', 'synchronized',
  'atomic', 'race', 'optimistic', 'pessimistic', 'transaction', 'idempotent',
  'version',
];

/**
 * Did the design think about what goes wrong?
 *
 * The bulk of the score comes from the problem's **implied requirements** — the
 * cases the brief deliberately does not mention, which a mentor authored
 * alongside the problem: a full lot, two cars racing for the last spot, an
 * equal split of 100 across three people. Those come with per-problem signal
 * sets, so they are a far sharper instrument than a global word list, and they
 * reward the learner for noticing the case rather than for using a particular
 * vocabulary.
 *
 * The generic vocabulary is kept as a smaller secondary signal, because a
 * design can be thoughtful about failure in ways this problem's author did not
 * anticipate, and that should still count for something.
 *
 * Reading the implied requirements here as well as in `RequirementCoverageCheck`
 * is deliberate rather than double counting: that check asks *did you cover the
 * brief*, this one asks *did you think past it*. Same evidence, two questions.
 */
export class EdgeCaseCheck implements DesignCheck {
  readonly id = 'edge-case-awareness';
  readonly dimension = 'edge_cases' as const;

  run({ design, problem }: EvaluationContext): CheckResult {
    const implied = problem.requirements.filter((r) => r.kind === 'implied');
    const covered = implied.filter((r) => matchedTerms(design.searchText, r.signals).length > 0);
    const missed = implied.filter((r) => !covered.includes(r));

    const failures = matchedTerms(design.searchText, FAILURE_SIGNALS);
    const concurrency = matchedTerms(design.searchText, CONCURRENCY_SIGNALS);
    const concurrencyMatters = problem.tags.includes('concurrency');

    // Authored cases carry the score; generic vocabulary tops it up.
    const impliedScore = implied.length === 0 ? null : (covered.length / implied.length) * 100;
    const vocabularyScore = Math.min(100, 15 + 20 * failures.length + 25 * concurrency.length);
    const score =
      impliedScore === null ? vocabularyScore : impliedScore * 0.7 + vocabularyScore * 0.3;

    const feedback: Array<Omit<FeedbackItem, 'source'>> = [];

    if (missed.length > 0) {
      feedback.push({
        id: 'edge-cases-missed',
        kind: 'gap',
        dimension: this.dimension,
        title: `${missed.length} case${missed.length > 1 ? 's' : ''} the brief did not mention, and neither did your design`,
        detail:
          `${missed.map((r) => `• ${r.text}`).join('\n')}\n\n` +
          'Noticing what the requirements leave out is most of what separates a design that survives review.',
      });
    }

    if (covered.length > 0) {
      feedback.push({
        id: 'edge-cases-anticipated',
        kind: 'strength',
        dimension: this.dimension,
        title: `You anticipated ${covered.length} case${covered.length > 1 ? 's' : ''} the brief never stated`,
        detail: covered.map((r) => `• ${r.text}`).join('\n'),
      });
    }

    if (failures.length === 0) {
      feedback.push({
        id: 'no-failure-paths',
        kind: 'gap',
        dimension: this.dimension,
        title: 'Only the happy path is described',
        detail:
          'Nothing in the design says what happens when an operation cannot succeed. Pick your two or three riskiest operations and say what each returns or throws when its precondition does not hold.',
      });
    }

    if (concurrencyMatters && concurrency.length === 0) {
      feedback.push({
        id: 'no-concurrency',
        kind: 'gap',
        dimension: this.dimension,
        title: 'Concurrent access is not addressed',
        detail:
          'This problem has a shared resource two requests can reach at the same moment. Name where the contention is and how you resolve it — a lock, an atomic reservation, or an optimistic version check are all defensible; silence is not.',
      });
    }

    return {
      score: clampScore(score),
      rationale: `${covered.length}/${implied.length} unstated cases anticipated; ${failures.length} failure-path and ${concurrency.length} concurrency signals.`,
      feedback,
    };
  }
}

import type { EvaluationContext } from '../../Evaluator.js';
import { clampScore } from '../../Evaluator.js';
import { matchedTerms, type CheckResult, type DesignCheck } from '../DesignCheck.js';

/**
 * Problem-specific traps, authored alongside the problem itself.
 *
 * Where the other checks are general rules, this one carries the knowledge a
 * mentor has about *this* problem — "modelling a slot as a boolean" on parking
 * lot, "one lift queue for the whole building" on elevator. Keeping it as data
 * on the Problem means adding a problem adds its own pitfalls, with no new code.
 */
export class PitfallCheck implements DesignCheck {
  readonly id = 'known-pitfalls';
  readonly dimension = 'abstraction_quality' as const;

  run({ problem, design }: EvaluationContext): CheckResult {
    if (problem.pitfalls.length === 0) {
      return { score: null, rationale: 'No pitfalls authored for this problem.', feedback: [] };
    }

    const triggered = problem.pitfalls.filter(
      (p) => matchedTerms(design.searchText, p.triggers).length > 0,
    );

    const feedback = triggered.map((p) => ({
      id: `pitfall-${p.id}`,
      kind: 'pitfall' as const,
      dimension: this.dimension,
      title: p.summary,
      detail: p.guidance,
    }));

    return {
      score: clampScore(100 - 18 * triggered.length),
      rationale: `${triggered.length}/${problem.pitfalls.length} known pitfalls detected.`,
      feedback,
    };
  }
}

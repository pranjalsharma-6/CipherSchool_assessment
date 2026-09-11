import type { RequirementCoverage } from '../../../domain/evaluation/Evaluation.js';
import type { EvaluationContext } from '../../Evaluator.js';
import { matchedTerms, ratioToScore, type CheckResult, type DesignCheck } from '../DesignCheck.js';

/**
 * Did the design visibly address each stated requirement?
 *
 * This is the check that most justifies being deterministic: the requirements
 * are a finite list the platform authored, so "you never mention how a ticket
 * is priced" is a fact, not an opinion, and it should not cost an API call or
 * vary between runs. Implied requirements are matched too but weighted lower,
 * since missing one is a prompt to think rather than a mistake.
 */
export class RequirementCoverageCheck implements DesignCheck {
  readonly id = 'requirement-coverage';
  readonly dimension = 'requirement_coverage' as const;

  run({ problem, design }: EvaluationContext): CheckResult {
    const coverage: RequirementCoverage[] = problem.requirements.map((requirement) => {
      const matched = matchedTerms(design.searchText, requirement.signals);
      return {
        requirementId: requirement.id,
        text: requirement.text,
        kind: requirement.kind,
        covered: matched.length > 0,
        matchedSignals: matched,
      };
    });

    const stated = coverage.filter((c) => c.kind === 'stated');
    const implied = coverage.filter((c) => c.kind === 'implied');
    const statedCovered = stated.filter((c) => c.covered).length;
    const impliedCovered = implied.filter((c) => c.covered).length;

    // Stated requirements carry the score; implied ones can add a little on top.
    const statedScore = ratioToScore(statedCovered, stated.length);
    const impliedBonus =
      implied.length === 0 ? 0 : Math.round(10 * (impliedCovered / implied.length));
    const score = Math.min(100, statedScore === 0 ? 0 : statedScore + impliedBonus);

    const feedback = [];

    const missedStated = stated.filter((c) => !c.covered);
    if (missedStated.length > 0) {
      feedback.push({
        id: 'requirements-missed',
        kind: 'gap' as const,
        dimension: this.dimension,
        title: `${missedStated.length} stated requirement${missedStated.length > 1 ? 's' : ''} not visible in your design`,
        detail:
          `Nothing in your classes, relationships or notes appears to handle:\n` +
          missedStated.map((c) => `• ${c.text}`).join('\n') +
          `\n\nIf you did handle these, name the responsible class explicitly: an ` +
          `interviewer reads the design, not your intent.`,
      });
    }

    const missedImplied = implied.filter((c) => !c.covered);
    for (const missed of missedImplied) {
      feedback.push({
        id: `implied-${missed.requirementId}`,
        kind: 'question' as const,
        dimension: this.dimension,
        title: 'Unstated requirement worth considering',
        detail: `${missed.text} This was not in the brief: good designs surface it anyway.`,
        requirementId: missed.requirementId,
      });
    }

    if (missedStated.length === 0 && stated.length > 0) {
      feedback.push({
        id: 'requirements-complete',
        kind: 'strength' as const,
        dimension: this.dimension,
        title: 'Every stated requirement is accounted for',
        detail: `All ${stated.length} requirements map onto something concrete in your design.`,
      });
    }

    return {
      score,
      rationale: `${statedCovered}/${stated.length} stated and ${impliedCovered}/${implied.length} implied requirements detected in the design.`,
      feedback,
      requirementCoverage: coverage,
    };
  }
}

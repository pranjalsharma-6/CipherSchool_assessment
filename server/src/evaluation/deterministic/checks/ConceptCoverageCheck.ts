import type { FeedbackItem } from '../../../domain/evaluation/Evaluation.js';
import type { EvaluationContext } from '../../Evaluator.js';
import { matchedTerms, ratioToScore, type CheckResult, type DesignCheck } from '../DesignCheck.js';

/**
 * Does the design give the problem's core concepts a home?
 *
 * The wording of this check is the platform's answer to "there is more than one
 * valid LLD solution". It never says a concept is missing — it says nothing was
 * *detected* that owns it, and asks. A learner who folded pricing into
 * `Ticket` on purpose can read that, disagree, and be right; a learner who
 * simply forgot gets the nudge. Scoring reflects that: the floor is 40, so
 * disagreeing with the reference design costs some marks, never all of them.
 */
export class ConceptCoverageCheck implements DesignCheck {
  readonly id = 'concept-coverage';
  readonly dimension = 'abstraction_quality' as const;

  run({ problem, design }: EvaluationContext): CheckResult {
    if (problem.expectedConcepts.length === 0) {
      return { score: null, rationale: 'No reference concepts defined.', feedback: [] };
    }

    const results = problem.expectedConcepts.map((concept) => ({
      concept,
      matched: matchedTerms(design.searchText, [concept.name, ...concept.aliases]),
    }));

    const present = results.filter((r) => r.matched.length > 0);
    const absent = results.filter((r) => r.matched.length === 0);

    const feedback: Array<Omit<FeedbackItem, 'source'>> = absent.map((r) => ({
      id: `concept-${slug(r.concept.name)}`,
      kind: 'question' as const,
      dimension: this.dimension,
      title: `Nothing detected that owns ${r.concept.name.toLowerCase()}`,
      detail: `${r.concept.why} A common approach is a dedicated abstraction, but folding it into an existing class can be the right call — if you did that deliberately, say which class owns it and why.`,
    }));

    if (present.length > 0 && absent.length === 0) {
      feedback.push({
        id: 'concepts-complete',
        kind: 'strength' as const,
        dimension: this.dimension,
        title: 'Core concepts all have an owner',
        detail: `Each of the ${present.length} concepts this problem turns on is represented in your design.`,
      });
    }

    return {
      score: ratioToScore(present.length, results.length, 40),
      rationale: `${present.length}/${results.length} reference concepts detected.`,
      feedback,
    };
  }
}

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

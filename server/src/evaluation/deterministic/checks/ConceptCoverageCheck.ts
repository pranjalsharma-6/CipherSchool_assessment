import type { FeedbackItem } from '../../../domain/evaluation/Evaluation.js';
import type { DesignEntity } from '../../../domain/attempt/DesignModel.js';
import type { EvaluationContext } from '../../Evaluator.js';
import { clampScore } from '../../Evaluator.js';
import { matchedTerms, mentions, type CheckResult, type DesignCheck } from '../DesignCheck.js';

/** How the design accounts for one of the problem's core concepts. */
type Ownership = 'dedicated' | 'folded' | 'absent';

/**
 * Does the design give the problem's core concepts a home, and *what kind* of
 * home?
 *
 * This check is where the platform's answer to "there is more than one valid
 * design" gets expressed precisely. Three outcomes, not two:
 *
 *   - **dedicated**: a type is named for the concept. Full credit.
 *   - **folded**   : the concept appears only inside another type's members or
 *                     prose, e.g. `calculateFee()` hanging off a god class.
 *                     Half credit and a question, because folding a concept in
 *                     is sometimes exactly right and sometimes the tell of a
 *                     class doing too much, and a rule cannot tell which.
 *   - **absent**   : nothing at all. No credit, and a prompt.
 *
 * Grading `folded` the same as `dedicated` was the earlier behaviour, and it
 * let a design that merely name-drops score as well as one that models the
 * concept. Grading it the same as `absent` would be worse: it would assert that
 * the reference decomposition is the only correct one, which is the exact bias
 * this platform exists to avoid. Half credit says what is actually true, that
 * the concept is present but its ownership is unclear from the design alone.
 */
export class ConceptCoverageCheck implements DesignCheck {
  readonly id = 'concept-coverage';
  readonly dimension = 'abstraction_quality' as const;

  run({ problem, design }: EvaluationContext): CheckResult {
    if (problem.expectedConcepts.length === 0) {
      return { score: null, rationale: 'No reference concepts defined.', feedback: [] };
    }

    const results = problem.expectedConcepts.map((concept) => {
      const terms = [concept.name, ...concept.aliases];
      return {
        concept,
        ownership: classify(terms, design.entities, design.searchText),
        matched: matchedTerms(design.searchText, terms),
      };
    });

    const dedicated = results.filter((r) => r.ownership === 'dedicated');
    const folded = results.filter((r) => r.ownership === 'folded');
    const absent = results.filter((r) => r.ownership === 'absent');

    const feedback: Array<Omit<FeedbackItem, 'source'>> = [];

    for (const result of absent) {
      feedback.push({
        id: `concept-${slug(result.concept.name)}`,
        kind: 'question',
        dimension: this.dimension,
        title: `Nothing detected that owns ${result.concept.name.toLowerCase()}`,
        detail: `${result.concept.why} A common approach is a dedicated abstraction, but folding it into an existing class can be the right call, if you did that deliberately, say which class owns it and why.`,
      });
    }

    for (const result of folded) {
      feedback.push({
        id: `concept-folded-${slug(result.concept.name)}`,
        kind: 'question',
        dimension: this.dimension,
        title: `${result.concept.name} appears folded into another class`,
        detail: `Your design mentions it (${result.matched.slice(0, 3).join(', ')}) but no type is named for it. ${result.concept.why} That can be the right trade for a small design: worth saying which class owns it and why, because an interviewer will ask.`,
      });
    }

    if (dedicated.length > 0 && absent.length === 0 && folded.length === 0) {
      feedback.push({
        id: 'concepts-complete',
        kind: 'strength',
        dimension: this.dimension,
        title: 'Core concepts all have their own home',
        detail: `Each of the ${dedicated.length} concepts this problem turns on is modelled as its own type.`,
      });
    }

    // Floor of 30: departing from the reference decomposition costs marks, and
    // never all of them.
    const credit = dedicated.length + folded.length * 0.5;
    const score = clampScore(30 + 70 * (credit / results.length));

    return {
      score,
      rationale: `${dedicated.length}/${results.length} reference concepts modelled as their own type${
        folded.length > 0 ? `, ${folded.length} folded into another class` : ''
      }.`,
      feedback,
    };
  }
}

/** A concept is "owned" when a type is named for it, not merely when it is mentioned. */
function classify(
  terms: readonly string[],
  entities: readonly DesignEntity[],
  searchText: string,
): Ownership {
  const named = entities.some((entity) => terms.some((term) => nameMatches(entity.name, term)));
  if (named) return 'dedicated';
  return matchedTerms(searchText, terms).length > 0 ? 'folded' : 'absent';
}

/**
 * `PricingStrategy` should satisfy the alias `pricing`, and `HourlyPricing`
 * should too, so a type name counts when it contains the term as a word,
 * comparing with identifier separators removed.
 */
function nameMatches(entityName: string, term: string): boolean {
  const name = entityName.toLowerCase();
  const needle = term.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!needle) return false;
  return name.replace(/[^a-z0-9]/g, '').includes(needle) || mentions(name, term);
}

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

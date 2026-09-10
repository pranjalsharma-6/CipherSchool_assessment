import type { EvaluationContext } from '../../Evaluator.js';
import { clampScore } from '../../Evaluator.js';
import type { CheckResult, DesignCheck } from '../DesignCheck.js';

/** Names that almost always mean "I could not decide what this class is". */
const VAGUE_NAME = /(manager|helper|util|utils|utility|handler|processor|service|data|info|object)$/i;

/** Members past this in one class is the usual sign of a god object. */
const CROWDED_MEMBERS = 9;

/**
 * Structural smells in how responsibility was distributed.
 *
 * Every rule here is a heuristic with a well-known counter-example — a
 * `PaymentService` is a perfectly good class — so each finding is phrased as a
 * prompt and the deduction is small. The point is to make the learner defend a
 * choice, not to assert that a name is wrong.
 */
export class ResponsibilityCheck implements DesignCheck {
  readonly id = 'responsibility-distribution';
  readonly dimension = 'abstraction_quality' as const;

  run({ design }: EvaluationContext): CheckResult {
    if (design.entities.length === 0) {
      return { score: 0, rationale: 'No classes were detected in the submission.', feedback: [] };
    }

    const feedback = [];
    let score = 100;

    const crowded = design.entities.filter((e) => e.members.length > CROWDED_MEMBERS);
    if (crowded.length > 0) {
      score -= 15 * crowded.length;
      feedback.push({
        id: 'god-class',
        kind: 'gap' as const,
        dimension: this.dimension,
        title: `${crowded.map((e) => e.name).join(', ')} may be doing too much`,
        detail: `${crowded
          .map((e) => `${e.name} carries ${e.members.length} members`)
          .join('; ')}. Ask what would make this class change: if you can name two unrelated reasons, it is two classes.`,
      });
    }

    const vague = design.entities.filter((e) => VAGUE_NAME.test(e.name));
    if (vague.length >= 2) {
      score -= 10;
      feedback.push({
        id: 'vague-naming',
        kind: 'suggestion' as const,
        dimension: this.dimension,
        title: 'Several classes are named after a role rather than a thing',
        detail: `${vague
          .map((e) => e.name)
          .join(
            ', ',
          )} — names like these often absorb behaviour that belongs on the domain object itself. Worth checking whether ${vague[0]?.name} is hiding a real noun.`,
      });
    }

    const described = design.entities.filter((e) => e.responsibility.trim().length >= 15);
    const describedRatio = described.length / design.entities.length;
    if (describedRatio < 0.6 && design.entities.length >= 3) {
      score -= 12;
      feedback.push({
        id: 'missing-responsibilities',
        kind: 'suggestion' as const,
        dimension: this.dimension,
        title: 'Most classes have no stated responsibility',
        detail:
          'A one-line "this class is responsible for…" per class is the fastest way to catch an overloaded abstraction before you write any code.',
      });
    }

    const singleClass = design.entities.length < 3;
    if (singleClass) {
      score -= 20;
      feedback.push({
        id: 'too-few-classes',
        kind: 'gap' as const,
        dimension: this.dimension,
        title: 'The design is very small for this problem',
        detail: `Only ${design.entities.length} type${design.entities.length === 1 ? '' : 's'} were detected. Most LLD problems need distinct types for the actors, the resources they use, and the policies that decide behaviour.`,
      });
    }

    if (feedback.length === 0) {
      feedback.push({
        id: 'responsibility-clean',
        kind: 'strength' as const,
        dimension: this.dimension,
        title: 'Responsibilities are spread sensibly',
        detail: `${design.entities.length} types, none of them crowded, each with a stated job.`,
      });
    }

    return {
      score: clampScore(score),
      rationale: `${design.entities.length} types; ${crowded.length} crowded; ${described.length} with a stated responsibility.`,
      feedback,
    };
  }
}

import type { EvaluationContext } from '../../Evaluator.js';
import { clampScore } from '../../Evaluator.js';
import type { CheckResult, DesignCheck } from '../DesignCheck.js';

/**
 * Are the classes actually wired together, and is the wiring specific?
 *
 * The most common weak LLD answer is a correct-looking list of nouns with no
 * stated relationships — which hides exactly the decisions an interviewer wants
 * to see: who owns whom, how many, and whether the link is inheritance or
 * containment. This check grades the wiring, not the nouns.
 */
export class RelationshipCheck implements DesignCheck {
  readonly id = 'relationship-clarity';
  readonly dimension = 'relationships' as const;

  run({ design }: EvaluationContext): CheckResult {
    const { entities, relationships } = design;
    if (entities.length === 0) {
      return { score: 0, rationale: 'No classes to relate.', feedback: [] };
    }

    const feedback = [];
    let score = 100;

    if (relationships.length === 0) {
      return {
        score: 10,
        rationale: 'No relationships were declared between the classes.',
        feedback: [
          {
            id: 'no-relationships',
            kind: 'gap' as const,
            dimension: this.dimension,
            title: 'No relationships between your classes',
            detail:
              'A list of classes is not yet a design. State who holds a reference to whom, and how many — that is where most LLD discussions actually happen.',
          },
        ],
      };
    }

    // Classes nothing points at and which point at nothing are usually leftovers.
    const connected = new Set<string>();
    for (const r of relationships) {
      connected.add(r.from.toLowerCase());
      connected.add(r.to.toLowerCase());
    }
    const orphans = entities.filter((e) => !connected.has(e.name.toLowerCase()));
    if (orphans.length > 0) {
      score -= Math.min(30, 12 * orphans.length);
      feedback.push({
        id: 'orphan-entities',
        kind: 'gap' as const,
        dimension: this.dimension,
        title: `${orphans.map((e) => e.name).join(', ')} ${orphans.length === 1 ? 'is' : 'are'} not connected to anything`,
        detail:
          'Every class should be reachable from the design. If nothing references it, either it is dead or you have left out the relationship that makes it useful.',
      });
    }

    // Cardinality is the detail that separates "has bookings" from a real model.
    const cardinalityCandidates = relationships.filter(
      (r) => r.kind === 'association' || r.kind === 'aggregation' || r.kind === 'composition',
    );
    const withCardinality = cardinalityCandidates.filter(
      (r) => r.cardinality && r.cardinality.trim().length > 0,
    );
    if (cardinalityCandidates.length > 0 && withCardinality.length === 0) {
      score -= 25;
      feedback.push({
        id: 'no-cardinality',
        kind: 'suggestion' as const,
        dimension: this.dimension,
        title: 'None of your relationships state cardinality',
        detail:
          'Mark each one 1..1, 1..*, or 0..*. Getting this wrong is the single most common source of a design that cannot express a real case — one slot holding many vehicles, one order with no items.',
      });
    } else if (
      cardinalityCandidates.length > 1 &&
      withCardinality.length < cardinalityCandidates.length / 2
    ) {
      score -= 12;
      feedback.push({
        id: 'partial-cardinality',
        kind: 'suggestion' as const,
        dimension: this.dimension,
        title: 'Cardinality is only given for some relationships',
        detail: `${withCardinality.length} of ${cardinalityCandidates.length} associations say how many. Fill in the rest — the missing ones are usually where the modelling gets interesting.`,
      });
    }

    const hierarchical = relationships.filter(
      (r) => r.kind === 'inheritance' || r.kind === 'implements',
    );
    if (hierarchical.length > entities.length) {
      score -= 10;
      feedback.push({
        id: 'deep-hierarchy',
        kind: 'question' as const,
        dimension: this.dimension,
        title: 'The design leans heavily on inheritance',
        detail: `${hierarchical.length} inheritance or implements links across ${entities.length} types. Check whether any of them is really "has-a" — composition usually survives requirement changes better.`,
      });
    }

    if (feedback.length === 0) {
      feedback.push({
        id: 'relationships-clear',
        kind: 'strength' as const,
        dimension: this.dimension,
        title: 'Relationships are explicit and specific',
        detail: `${relationships.length} links, ${withCardinality.length} of them with cardinality, and no stranded classes.`,
      });
    }

    return {
      score: clampScore(score),
      rationale: `${relationships.length} relationships, ${withCardinality.length}/${cardinalityCandidates.length} with cardinality, ${orphans.length} orphan types.`,
      feedback,
    };
  }
}

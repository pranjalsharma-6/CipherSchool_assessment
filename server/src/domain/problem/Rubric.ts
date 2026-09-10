import { ValidationError } from '../shared/errors.js';

/**
 * The dimensions every LLD attempt is scored on.
 *
 * The list is deliberately fixed and small: a learner comparing attempt #1 to
 * attempt #4 needs the axes to mean the same thing every time, otherwise the
 * progress view is noise. Problems tune the *weights*, not the axes.
 */
export const RUBRIC_DIMENSIONS = [
  'requirement_coverage',
  'abstraction_quality',
  'relationships',
  'extensibility',
  'edge_cases',
  'tradeoff_reasoning',
] as const;

export type RubricDimensionId = (typeof RUBRIC_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<RubricDimensionId, string> = {
  requirement_coverage: 'Requirement Coverage',
  abstraction_quality: 'Abstraction & Responsibility',
  relationships: 'Relationships & Cardinality',
  extensibility: 'Extensibility',
  edge_cases: 'Edge Cases & Concurrency',
  tradeoff_reasoning: 'Trade-off Reasoning',
};

/**
 * How much a dimension counts, and who is trusted to judge it.
 *
 * `deterministicShare` is the crux of the evaluation design. Coverage of
 * stated requirements is checkable by machine, so it leans deterministic;
 * whether an abstraction is *well chosen* is a judgement call, so it leans on
 * the LLM. Encoding the split as data — rather than as `if` statements in the
 * evaluator — means re-balancing trust in the model is a config change.
 */
export interface RubricDimension {
  readonly id: RubricDimensionId;
  readonly label: string;
  /** Relative weight within the rubric. Normalised at construction. */
  readonly weight: number;
  /** 0 = judged purely by the LLM, 1 = judged purely by deterministic rules. */
  readonly deterministicShare: number;
}

export class Rubric {
  private constructor(readonly dimensions: readonly RubricDimension[]) {}

  static of(
    weights: Partial<Record<RubricDimensionId, number>>,
    deterministicShares: Partial<Record<RubricDimensionId, number>> = {},
  ): Rubric {
    const dimensions = RUBRIC_DIMENSIONS.map((id) => {
      const weight = weights[id] ?? 1;
      const share = deterministicShares[id] ?? DEFAULT_DETERMINISTIC_SHARE[id];
      if (weight < 0) throw new ValidationError(`Rubric weight for '${id}' must be >= 0`);
      if (share < 0 || share > 1) {
        throw new ValidationError(`deterministicShare for '${id}' must be within [0, 1]`);
      }
      return { id, label: DIMENSION_LABELS[id], weight, deterministicShare: share };
    });

    const total = dimensions.reduce((sum, d) => sum + d.weight, 0);
    if (total <= 0) throw new ValidationError('Rubric must have at least one positive weight');

    return new Rubric(dimensions.map((d) => ({ ...d, weight: d.weight / total })));
  }

  static default(): Rubric {
    return Rubric.of({});
  }

  dimension(id: RubricDimensionId): RubricDimension {
    const found = this.dimensions.find((d) => d.id === id);
    if (!found) throw new ValidationError(`Unknown rubric dimension '${id}'`);
    return found;
  }
}

/**
 * Defaults chosen from what each axis actually is:
 * requirement coverage is a checklist (mostly deterministic), trade-off
 * reasoning is an argument (only a reader can judge it).
 */
const DEFAULT_DETERMINISTIC_SHARE: Record<RubricDimensionId, number> = {
  requirement_coverage: 0.7,
  abstraction_quality: 0.3,
  relationships: 0.5,
  extensibility: 0.3,
  edge_cases: 0.4,
  tradeoff_reasoning: 0.0,
};

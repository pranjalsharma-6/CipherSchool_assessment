import type { RubricDimensionId } from '../../domain/problem/Rubric.js';
import type { FeedbackItem, RequirementCoverage } from '../../domain/evaluation/Evaluation.js';
import type {
  DimensionAssessment,
  EvaluationContext,
  EvaluationContribution,
  Evaluator,
} from '../Evaluator.js';
import type { DesignCheck } from './DesignCheck.js';
import { ConceptCoverageCheck } from './checks/ConceptCoverageCheck.js';
import { EdgeCaseCheck } from './checks/EdgeCaseCheck.js';
import { ExtensibilityCheck } from './checks/ExtensibilityCheck.js';
import { PitfallCheck } from './checks/PitfallCheck.js';
import { RelationshipCheck } from './checks/RelationshipCheck.js';
import { RequirementCoverageCheck } from './checks/RequirementCoverageCheck.js';
import { ResponsibilityCheck } from './checks/ResponsibilityCheck.js';
import { TradeoffCheck } from './checks/TradeoffCheck.js';

/**
 * Runs every {@link DesignCheck} and merges their verdicts per dimension.
 *
 * Deliberately synchronous, dependency-free and fast (single-digit
 * milliseconds). That is what lets it be the platform's floor: whatever happens
 * to the model, the network, or the API budget, a learner who submits gets a
 * real score with real evidence back.
 */
export class DeterministicEvaluator implements Evaluator {
  readonly name = 'deterministic';
  readonly version = '1.0.0';
  readonly source = 'deterministic' as const;

  private readonly checks: readonly DesignCheck[];

  constructor(checks?: readonly DesignCheck[]) {
    this.checks = checks ?? DeterministicEvaluator.defaultChecks();
  }

  static defaultChecks(): readonly DesignCheck[] {
    return [
      new RequirementCoverageCheck(),
      new ConceptCoverageCheck(),
      new ResponsibilityCheck(),
      new RelationshipCheck(),
      new ExtensibilityCheck(),
      new EdgeCaseCheck(),
      new TradeoffCheck(),
      new PitfallCheck(),
    ];
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationContribution> {
    const byDimension = new Map<RubricDimensionId, { scores: number[]; rationales: string[] }>();
    const feedback: FeedbackItem[] = [];
    let requirementCoverage: readonly RequirementCoverage[] | undefined;

    for (const check of this.checks) {
      const result = check.run(context);

      if (result.score !== null) {
        const bucket = byDimension.get(check.dimension) ?? { scores: [], rationales: [] };
        bucket.scores.push(result.score);
        bucket.rationales.push(result.rationale);
        byDimension.set(check.dimension, bucket);
      }

      for (const item of result.feedback) {
        feedback.push({ ...item, source: this.source });
      }
      if (result.requirementCoverage) requirementCoverage = result.requirementCoverage;
    }

    // Several checks can land on one dimension (concepts, responsibility and
    // pitfalls all speak to abstraction quality); the mean keeps any single
    // heuristic from dominating an axis.
    const dimensions: DimensionAssessment[] = [...byDimension.entries()].map(
      ([dimension, { scores, rationales }]) => ({
        dimension,
        score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        rationale: rationales.join(' '),
      }),
    );

    return {
      source: this.source,
      dimensions,
      feedback,
      ...(requirementCoverage ? { requirementCoverage } : {}),
    };
  }
}
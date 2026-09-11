import type { Rubric, RubricDimensionId } from '../domain/problem/Rubric.js';
import { DIMENSION_LABELS } from '../domain/problem/Rubric.js';
import type { DimensionScore } from '../domain/evaluation/Evaluation.js';
import { clampScore, type EvaluationContribution } from './Evaluator.js';

export interface AggregatedScore {
  readonly overallScore: number;
  readonly dimensionScores: readonly DimensionScore[];
}

/**
 * Blends the evaluators' opinions into the rubric.
 *
 * The blend per dimension is the rubric's `deterministicShare`, so how much the
 * model is trusted is a property of the *dimension* rather than of the
 * evaluator: requirement coverage barely listens to the model, trade-off
 * reasoning listens only to it. When one side is missing: the usual case being
 * a degraded run with no LLM, that dimension falls back to whichever side
 * reported, and the overall score renormalises over the dimensions that were
 * actually assessed, so a degraded run is not silently scored out of a
 * different total.
 */
export class ScoreAggregator {
  aggregate(rubric: Rubric, contributions: readonly EvaluationContribution[]): AggregatedScore {
    const deterministic = index(contributions, 'deterministic');
    const llm = index(contributions, 'llm');

    const dimensionScores: DimensionScore[] = [];

    for (const dimension of rubric.dimensions) {
      const det = deterministic.get(dimension.id);
      const model = llm.get(dimension.id);
      if (det === undefined && model === undefined) continue;

      const score = blend(det?.score, model?.score, dimension.deterministicShare);

      dimensionScores.push({
        dimension: dimension.id,
        label: DIMENSION_LABELS[dimension.id],
        score: clampScore(score),
        weight: dimension.weight,
        deterministicScore: det?.score ?? null,
        llmScore: model?.score ?? null,
        rationale: [det?.rationale, model?.rationale].filter(Boolean).join(' ').trim(),
      });
    }

    const totalWeight = dimensionScores.reduce((sum, d) => sum + d.weight, 0);
    const overallScore =
      totalWeight === 0
        ? 0
        : clampScore(
            dimensionScores.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight,
          );

    return { overallScore, dimensionScores };
  }
}

function blend(
  deterministic: number | undefined,
  llm: number | undefined,
  deterministicShare: number,
): number {
  if (deterministic === undefined) return llm ?? 0;
  if (llm === undefined) return deterministic;
  return deterministic * deterministicShare + llm * (1 - deterministicShare);
}

function index(
  contributions: readonly EvaluationContribution[],
  source: EvaluationContribution['source'],
): Map<RubricDimensionId, { score: number; rationale: string }> {
  const map = new Map<RubricDimensionId, { score: number; rationale: string }>();
  for (const contribution of contributions) {
    if (contribution.source !== source) continue;
    for (const assessment of contribution.dimensions) {
      map.set(assessment.dimension, {
        score: clampScore(assessment.score),
        rationale: assessment.rationale,
      });
    }
  }
  return map;
}

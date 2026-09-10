import type { Clock } from '../domain/shared/ids.js';
import type {
  Evaluation,
  EvaluatorRun,
  FeedbackItem,
  RequirementCoverage,
} from '../domain/evaluation/Evaluation.js';
import type { EvaluationContext, EvaluationContribution, Evaluator } from './Evaluator.js';
import { ScoreAggregator } from './ScoreAggregator.js';

/** Ordering: strongest signal first, so the learner reads gaps before praise. */
const KIND_ORDER: Record<FeedbackItem['kind'], number> = {
  gap: 0,
  pitfall: 1,
  suggestion: 2,
  question: 3,
  strength: 4,
};

export interface PipelineOptions {
  /**
   * Evaluators that may fail without failing the evaluation. The deterministic
   * baseline is never optional — if it breaks, that is a bug worth surfacing.
   */
  readonly optional: ReadonlySet<string>;
}

/**
 * Runs the evaluators and assembles one {@link Evaluation}.
 *
 * The composition is the answer to "what happens when evaluation is slow or
 * fails": the baseline is a synchronous rule engine that cannot really fail, and
 * everything slow or fallible is optional on top. A model outage costs the
 * learner the qualitative half of their review — clearly marked, with a re-run
 * button — instead of costing them the submission.
 */
export class EvaluationPipeline {
  private readonly aggregator = new ScoreAggregator();

  constructor(
    private readonly baseline: Evaluator,
    private readonly optionalEvaluators: readonly Evaluator[],
    private readonly clock: Clock,
  ) {}

  async run(context: EvaluationContext): Promise<Evaluation> {
    const runs: EvaluatorRun[] = [];
    const contributions: EvaluationContribution[] = [];

    const baseline = await this.execute(this.baseline, context, runs);
    if (!baseline) {
      // Unreachable in practice: `execute` rethrows for the baseline evaluator.
      throw new Error('Baseline evaluation produced no result');
    }
    contributions.push(baseline);

    let degradedReason: string | null = null;

    for (const evaluator of this.optionalEvaluators) {
      if (evaluator.supports && !evaluator.supports(context)) {
        runs.push({ name: evaluator.name, version: evaluator.version, status: 'skipped', durationMs: 0 });
        continue;
      }
      const contribution = await this.execute(evaluator, context, runs, true);
      if (contribution) {
        contributions.push(contribution);
      } else {
        degradedReason ??= runs.find((r) => r.name === evaluator.name)?.error ?? 'Evaluator failed';
      }
    }

    const { overallScore, dimensionScores } = this.aggregator.aggregate(
      context.problem.rubric,
      contributions,
    );

    const feedback = dedupe(contributions.flatMap((c) => c.feedback)).sort(
      (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
    );

    const requirementCoverage: readonly RequirementCoverage[] =
      contributions.find((c) => c.requirementCoverage)?.requirementCoverage ?? [];

    const degraded = degradedReason !== null;

    return {
      overallScore,
      dimensionScores,
      feedback,
      requirementCoverage,
      summary:
        contributions.find((c) => c.summary)?.summary ??
        fallbackSummary(overallScore, feedback, degraded),
      degraded,
      degradedReason,
      evaluators: runs,
      generatedAt: this.clock.now(),
    };
  }

  private async execute(
    evaluator: Evaluator,
    context: EvaluationContext,
    runs: EvaluatorRun[],
    optional = false,
  ): Promise<EvaluationContribution | null> {
    const startedAt = Date.now();
    try {
      const contribution = await evaluator.evaluate(context);
      runs.push({
        name: evaluator.name,
        version: evaluator.version,
        status: 'ok',
        durationMs: Date.now() - startedAt,
      });
      return contribution;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runs.push({
        name: evaluator.name,
        version: evaluator.version,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        error: message,
      });
      if (!optional) throw error;
      return null;
    }
  }
}

/**
 * Two evaluators occasionally land on the same point from different angles.
 * The deterministic item wins ties, because it can show its evidence.
 */
function dedupe(items: readonly FeedbackItem[]): FeedbackItem[] {
  const seen = new Map<string, FeedbackItem>();
  for (const item of items) {
    const key = `${item.dimension}|${normalize(item.title)}`;
    const existing = seen.get(key);
    if (!existing || (existing.source === 'llm' && item.source === 'deterministic')) {
      seen.set(key, item);
    }
  }
  return [...seen.values()];
}

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Used when the model — which normally writes the summary — did not run. */
function fallbackSummary(
  score: number,
  feedback: readonly FeedbackItem[],
  degraded: boolean,
): string {
  const gaps = feedback.filter((f) => f.kind === 'gap' || f.kind === 'pitfall');
  const strengths = feedback.filter((f) => f.kind === 'strength');

  const parts: string[] = [`Your design scored ${score}/100 against this problem's rubric.`];
  if (strengths[0]) parts.push(`Working well: ${lowerFirst(strengths[0].title)}.`);
  if (gaps[0]) parts.push(`The most valuable thing to fix next: ${lowerFirst(gaps[0].title)}.`);
  else parts.push('No structural gaps were detected by the rule checks.');
  if (degraded) {
    parts.push(
      'This review is from the deterministic checks only — the reviewer model was unavailable, so the qualitative half is missing. Re-run the evaluation to get it.',
    );
  }
  return parts.join(' ');
}

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

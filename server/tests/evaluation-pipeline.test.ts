import { describe, expect, it } from 'vitest';
import { EvaluationPipeline } from '../src/evaluation/EvaluationPipeline.js';
import { DeterministicEvaluator } from '../src/evaluation/deterministic/DeterministicEvaluator.js';
import { LlmEvaluator } from '../src/evaluation/llm/LlmEvaluator.js';
import { LlmUnavailableError } from '../src/evaluation/llm/LlmClient.js';
import { StructuredNormalizer } from '../src/evaluation/normalizers/StructuredNormalizer.js';
import type { EvaluationContext, EvaluationContribution } from '../src/evaluation/Evaluator.js';
import {
  FakeClock,
  ScriptedLlmClient,
  problemBySlug,
  strongParkingLotSubmission,
  validLlmResponse,
  weakParkingLotSubmission,
} from './fixtures.js';

const clock = new FakeClock();
const normalizer = new StructuredNormalizer();

function contextFor(submission = strongParkingLotSubmission()): EvaluationContext {
  return {
    problem: problemBySlug('parking-lot'),
    submission,
    design: normalizer.normalize(submission),
    attemptNumber: 1,
    previousScore: null,
  };
}

const emptyDeterministic = (): EvaluationContribution => ({
  source: 'deterministic',
  dimensions: [],
  feedback: [],
});

describe('EvaluationPipeline', () => {
  it('scores a strong design well above a weak one', async () => {
    const pipeline = new EvaluationPipeline(new DeterministicEvaluator(), [], clock);

    const strong = await pipeline.run(contextFor(strongParkingLotSubmission()));
    const weak = await pipeline.run(contextFor(weakParkingLotSubmission()));

    expect(strong.overallScore).toBeGreaterThan(weak.overallScore + 25);
    expect(strong.overallScore).toBeGreaterThan(60);
    expect(weak.overallScore).toBeLessThan(45);
  });

  it('is reproducible: the same submission scores identically every run', async () => {
    const pipeline = new EvaluationPipeline(new DeterministicEvaluator(), [], clock);
    const context = contextFor();

    const first = await pipeline.run(context);
    const second = await pipeline.run(context);

    expect(second.overallScore).toBe(first.overallScore);
    expect(second.feedback.map((f) => f.title)).toEqual(first.feedback.map((f) => f.title));
  });

  it('blends the model score into the dimensions it owns', async () => {
    const client = new ScriptedLlmClient([validLlmResponse()]);
    const pipeline = new EvaluationPipeline(
      new DeterministicEvaluator(),
      [new LlmEvaluator(client, emptyDeterministic)],
      clock,
    );

    const result = await pipeline.run(contextFor());
    const tradeoffs = result.dimensionScores.find((d) => d.dimension === 'tradeoff_reasoning');

    expect(result.degraded).toBe(false);
    // tradeoff_reasoning has deterministicShare 0, so the model owns it outright.
    expect(tradeoffs?.llmScore).toBe(55);
    expect(tradeoffs?.score).toBe(55);
    expect(result.summary).toContain('interview-ready');
  });

  it('degrades to deterministic-only when the model is unavailable', async () => {
    const client = new ScriptedLlmClient([new LlmUnavailableError('rate limited')]);
    const pipeline = new EvaluationPipeline(
      new DeterministicEvaluator(),
      [new LlmEvaluator(client, emptyDeterministic)],
      clock,
    );

    const result = await pipeline.run(contextFor());

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain('rate limited');
    // The learner still gets a real, usable review rather than an error.
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.summary).toContain('deterministic checks only');
    expect(result.evaluators.find((e) => e.name === 'llm-reviewer')?.status).toBe('failed');
  });

  it('degrades rather than failing when the model returns unparseable output', async () => {
    const client = new ScriptedLlmClient(['I think this design is pretty good, honestly.']);
    const pipeline = new EvaluationPipeline(
      new DeterministicEvaluator(),
      [new LlmEvaluator(client, emptyDeterministic)],
      clock,
    );

    const result = await pipeline.run(contextFor());

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain('no JSON');
    expect(result.overallScore).toBeGreaterThan(0);
  });

  it('degrades when the model returns JSON of the wrong shape', async () => {
    const client = new ScriptedLlmClient([
      JSON.stringify({ summary: 'ok', dimensions: [{ dimension: 'vibes', score: 99 }] }),
    ]);
    const pipeline = new EvaluationPipeline(
      new DeterministicEvaluator(),
      [new LlmEvaluator(client, emptyDeterministic)],
      clock,
    );

    const result = await pipeline.run(contextFor());
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain('schema');
  });

  it('recovers JSON the model wrapped in prose or a code fence', async () => {
    const client = new ScriptedLlmClient([
      'Here is my review:\n```json\n' + validLlmResponse() + '\n```\nHope that helps!',
    ]);
    const pipeline = new EvaluationPipeline(
      new DeterministicEvaluator(),
      [new LlmEvaluator(client, emptyDeterministic)],
      clock,
    );

    const result = await pipeline.run(contextFor());
    expect(result.degraded).toBe(false);
    expect(result.summary).toContain('interview-ready');
  });

  it('never lets the model overrule the requirement-coverage evidence', async () => {
    // The model is told this design is perfect; the rule engine knows better,
    // and requirement_coverage is 70% deterministic by rubric.
    const client = new ScriptedLlmClient([
      validLlmResponse({
        dimensions: [{ dimension: 'abstraction_quality', score: 100, rationale: 'flawless' }],
      }),
    ]);
    const pipeline = new EvaluationPipeline(
      new DeterministicEvaluator(),
      [new LlmEvaluator(client, emptyDeterministic)],
      clock,
    );

    const result = await pipeline.run(contextFor(weakParkingLotSubmission()));
    const coverage = result.dimensionScores.find((d) => d.dimension === 'requirement_coverage');

    expect(coverage?.llmScore).toBeNull();
    expect(coverage?.score).toBeLessThan(60);
  });

  it('reports every requirement it could not find, with the evidence it did find', async () => {
    const pipeline = new EvaluationPipeline(new DeterministicEvaluator(), [], clock);
    const result = await pipeline.run(contextFor(weakParkingLotSubmission()));

    const uncovered = result.requirementCoverage.filter((r) => !r.covered);
    expect(uncovered.length).toBeGreaterThan(0);

    const covered = result.requirementCoverage.filter((r) => r.covered);
    for (const item of covered) expect(item.matchedSignals.length).toBeGreaterThan(0);
  });

  it('surfaces problem-specific pitfalls the learner walked into', async () => {
    const submission = strongParkingLotSubmission();
    const pipeline = new EvaluationPipeline(new DeterministicEvaluator(), [], clock);

    const result = await pipeline.run(
      contextFor({
        ...submission,
        tradeoffs: `${submission.tradeoffs} Pricing is decided with switch (vehicleType) inside Ticket.`,
      }),
    );

    expect(result.feedback.some((f) => f.kind === 'pitfall')).toBe(true);
  });
});

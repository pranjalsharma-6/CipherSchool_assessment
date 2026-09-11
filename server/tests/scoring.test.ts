import { describe, expect, it } from 'vitest';
import { ScoreAggregator } from '../src/evaluation/ScoreAggregator.js';
import { Rubric } from '../src/domain/problem/Rubric.js';
import { ValidationError } from '../src/domain/shared/errors.js';
import { extractJsonObject } from '../src/evaluation/llm/LlmEvaluator.js';
import type { EvaluationContribution } from '../src/evaluation/Evaluator.js';

const aggregator = new ScoreAggregator();

const deterministic = (
  entries: Array<[string, number]>,
): EvaluationContribution => ({
  source: 'deterministic',
  dimensions: entries.map(([dimension, score]) => ({
    dimension: dimension as never,
    score,
    rationale: 'rule',
  })),
  feedback: [],
});

const llm = (entries: Array<[string, number]>): EvaluationContribution => ({
  ...deterministic(entries),
  source: 'llm',
});

describe('Rubric', () => {
  it('normalises weights so they always sum to one', () => {
    const rubric = Rubric.of({ requirement_coverage: 3, abstraction_quality: 1 });
    const total = rubric.dimensions.reduce((sum, d) => sum + d.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('rejects a rubric that cannot produce a score', () => {
    expect(() =>
      Rubric.of({
        requirement_coverage: 0,
        abstraction_quality: 0,
        relationships: 0,
        extensibility: 0,
        edge_cases: 0,
        tradeoff_reasoning: 0,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a deterministic share outside [0, 1]', () => {
    expect(() => Rubric.of({}, { requirement_coverage: 1.5 })).toThrow(ValidationError);
  });
});

describe('ScoreAggregator', () => {
  it('blends the two sources by the dimension\'s deterministic share', () => {
    const rubric = Rubric.of({ abstraction_quality: 1 }, { abstraction_quality: 0.25 });

    const result = aggregator.aggregate(rubric, [
      deterministic([['abstraction_quality', 40]]),
      llm([['abstraction_quality', 80]]),
    ]);

    const dimension = result.dimensionScores.find((d) => d.dimension === 'abstraction_quality');
    // 40 * 0.25 + 80 * 0.75
    expect(dimension?.score).toBe(70);
    expect(dimension?.deterministicScore).toBe(40);
    expect(dimension?.llmScore).toBe(80);
  });

  it('falls back to whichever source reported when the other is missing', () => {
    const rubric = Rubric.of({}, { tradeoff_reasoning: 0 });

    const result = aggregator.aggregate(rubric, [deterministic([['tradeoff_reasoning', 62]])]);
    const dimension = result.dimensionScores.find((d) => d.dimension === 'tradeoff_reasoning');

    // deterministicShare is 0, but with no model score the rule still counts,
    // otherwise a degraded run would silently score this dimension zero.
    expect(dimension?.score).toBe(62);
    expect(dimension?.llmScore).toBeNull();
  });

  it('renormalises over the dimensions actually assessed', () => {
    const rubric = Rubric.default();

    const result = aggregator.aggregate(rubric, [
      deterministic([
        ['requirement_coverage', 80],
        ['abstraction_quality', 80],
      ]),
    ]);

    expect(result.dimensionScores).toHaveLength(2);
    // Not 80 * (2/6): a partial assessment is scored out of what it covered.
    expect(result.overallScore).toBe(80);
  });

  it('scores zero rather than throwing when nothing was assessed', () => {
    expect(aggregator.aggregate(Rubric.default(), []).overallScore).toBe(0);
  });

  it('clamps a model that returns a score outside the range', () => {
    const rubric = Rubric.of({ extensibility: 1 }, { extensibility: 0 });

    expect(
      aggregator.aggregate(rubric, [llm([['extensibility', 480]])]).dimensionScores[0]?.score,
    ).toBe(100);
    expect(
      aggregator.aggregate(rubric, [llm([['extensibility', -20]])]).dimensionScores[0]?.score,
    ).toBe(0);
  });
});

describe('extractJsonObject', () => {
  it('finds the object inside a fenced block', () => {
    expect(extractJsonObject('text\n```json\n{"a":1}\n```\nmore')).toBe('{"a":1}');
  });

  it('does not stop at a brace inside a string literal', () => {
    const raw = '{"detail":"use a Map<String, {x}> here","score":1}';
    expect(extractJsonObject(`prefix ${raw}`)).toBe(raw);
  });

  it('handles escaped quotes without losing the closing brace', () => {
    const raw = '{"detail":"the \\"Ticket\\" class"}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it('returns null when there is no object at all', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{"unterminated": true')).toBeNull();
  });
});

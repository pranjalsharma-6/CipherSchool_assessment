import { describe, expect, it } from 'vitest';
import { EvaluationPipeline } from '../src/evaluation/EvaluationPipeline.js';
import { DeterministicEvaluator } from '../src/evaluation/deterministic/DeterministicEvaluator.js';
import { StructuredNormalizer } from '../src/evaluation/normalizers/StructuredNormalizer.js';
import { seedProblems } from '../src/infrastructure/seed/problems.js';
import type { Problem } from '../src/domain/problem/Problem.js';
import type { StructuredSubmission } from '../src/domain/attempt/Submission.js';
import { RUBRIC_DIMENSIONS } from '../src/domain/problem/Rubric.js';
import { FakeClock, weakParkingLotSubmission } from './fixtures.js';

const clock = new FakeClock();
const normalizer = new StructuredNormalizer();
const pipeline = new EvaluationPipeline(new DeterministicEvaluator(), [], clock);

const problems = seedProblems();

/**
 * Builds a strong submission *out of the problem's own grading vocabulary*.
 *
 * This is a self-consistency check rather than a hand-written answer key. A
 * design that names every expected concept and speaks every requirement's
 * vocabulary is, by the checker's own definition, a good design, so if it
 * scores badly, the problem's signals or concepts are misconfigured, not the
 * design. The pay-off is that this guard covers every problem added later with
 * no new fixture to write.
 */
function idealSubmissionFor(problem: Problem): StructuredSubmission {
  const entities = problem.expectedConcepts.map((concept, index) => ({
    name: concept.name.replace(/[^A-Za-z]/g, '') || `Concept${index}`,
    // Alternating so the design has a genuine seam, as a strong one would.
    kind: (index % 3 === 0 ? 'interface' : 'class') as 'interface' | 'class',
    responsibility: `Owns ${concept.name.toLowerCase()} for this problem`,
    members: concept.aliases.slice(0, 3),
  }));

  const relationships = entities.slice(1).map((entity, index) => ({
    from: entities[0]!.name,
    to: entity.name,
    kind: index % 2 === 0 ? 'composition' : 'association',
    cardinality: index % 2 === 0 ? '1..*' : '1..1',
  }));

  // Every requirement's own vocabulary, so coverage should be complete.
  const requirementVocabulary = problem.requirements
    .map((requirement) => `${requirement.text} (${requirement.signals.join(', ')})`)
    .join(' ');

  return {
    format: 'structured',
    entities,
    relationships,
    operations: problem.requirements.slice(0, 3).map((requirement) => ({
      name: requirement.id,
      owner: entities[0]!.name,
      description: `${requirement.text} Rejects with an explicit error when invalid.`,
    })),
    tradeoffs:
      `${requirementVocabulary} I chose this decomposition because each policy that varies sits behind its own interface, ` +
      `instead of a switch inside the core domain: a new rule becomes a new class rather than an edit. ` +
      `The cost is one more indirection when reading the code. Concurrent access is guarded with a lock so two ` +
      `callers cannot both claim the same resource; invalid input fails fast rather than producing a bad record.`,
    assumptions: 'A single deployment. External boundaries are kept behind interfaces so the domain stays testable.',
  };
}

async function scoreOf(problem: Problem, submission: StructuredSubmission): Promise<number> {
  const evaluation = await pipeline.run({
    problem,
    submission,
    design: normalizer.normalize(submission),
    attemptNumber: 1,
    previousScore: null,
  });
  return evaluation.overallScore;
}

describe('seeded problem catalogue', () => {
  it('seeds problems with unique ids and slugs', () => {
    expect(new Set(problems.map((p) => p.id)).size).toBe(problems.length);
    expect(new Set(problems.map((p) => p.slug)).size).toBe(problems.length);
  });

  it.each(problems.map((p) => [p.slug, p] as const))(
    '%s is authored completely enough to practise',
    (_slug, problem) => {
      expect(problem.statedRequirements().length).toBeGreaterThanOrEqual(4);
      expect(problem.requirements.some((r) => r.kind === 'implied')).toBe(true);
      expect(problem.expectedConcepts.length).toBeGreaterThanOrEqual(3);
      expect(problem.pitfalls.length).toBeGreaterThanOrEqual(1);
      expect(problem.discussionPrompts.length).toBeGreaterThanOrEqual(2);
      expect(problem.statement.length).toBeGreaterThan(200);

      // Every requirement must be detectable, or it can never be marked covered.
      for (const requirement of problem.requirements) {
        expect(requirement.signals.length, `${requirement.id} has no signals`).toBeGreaterThan(0);
      }
      for (const concept of problem.expectedConcepts) {
        expect(concept.aliases.length, `${concept.name} has no aliases`).toBeGreaterThan(0);
      }
    },
  );

  it.each(problems.map((p) => [p.slug, p] as const))(
    '%s has a rubric that covers every dimension and sums to one',
    (_slug, problem) => {
      expect(problem.rubric.dimensions.map((d) => d.id).sort()).toEqual(
        [...RUBRIC_DIMENSIONS].sort(),
      );
      const total = problem.rubric.dimensions.reduce((sum, d) => sum + d.weight, 0);
      expect(total).toBeCloseTo(1, 6);
    },
  );

  it.each(problems.map((p) => [p.slug, p] as const))(
    '%s scores a design built from its own vocabulary highly',
    async (_slug, problem) => {
      // Catches a problem whose signals are too narrow to ever match, which
      // would silently punish good designs.
      expect(await scoreOf(problem, idealSubmissionFor(problem))).toBeGreaterThan(70);
    },
  );

  it.each(problems.map((p) => [p.slug, p] as const))(
    '%s separates a strong design from a generic one by a wide margin',
    async (_slug, problem) => {
      const strong = await scoreOf(problem, idealSubmissionFor(problem));
      const weak = await scoreOf(problem, weakParkingLotSubmission());

      expect(weak).toBeLessThan(55);
      expect(strong - weak).toBeGreaterThan(30);
    },
  );

  it.each(problems.map((p) => [p.slug, p] as const))(
    '%s marks every stated requirement covered when the design speaks its vocabulary',
    async (_slug, problem) => {
      const submission = idealSubmissionFor(problem);
      const evaluation = await pipeline.run({
        problem,
        submission,
        design: normalizer.normalize(submission),
        attemptNumber: 1,
        previousScore: null,
      });

      const uncovered = evaluation.requirementCoverage
        .filter((r) => r.kind === 'stated' && !r.covered)
        .map((r) => r.requirementId);

      expect(uncovered, `unmatchable signals on: ${uncovered.join(', ')}`).toEqual([]);
    },
  );
});

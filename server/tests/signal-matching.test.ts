import { describe, expect, it } from 'vitest';
import { mentions } from '../src/evaluation/deterministic/DesignCheck.js';
import { buildSearchText } from '../src/domain/attempt/DesignModel.js';
import { StructuredNormalizer } from '../src/evaluation/normalizers/StructuredNormalizer.js';
import { seedProblems } from '../src/infrastructure/seed/problems.js';
import { EvaluationPipeline } from '../src/evaluation/EvaluationPipeline.js';
import { DeterministicEvaluator } from '../src/evaluation/deterministic/DeterministicEvaluator.js';
import { FakeClock } from './fixtures.js';

/**
 * Signal matching decides every deterministic verdict, so its edges are worth
 * pinning down. Both behaviours below started as real false negatives found by
 * running hand-written designs through the platform: a design saying
 * "requests arrive concurrently" scored as though it had never mentioned
 * concurrency, and one with an `onCarUnavailable` handler scored as though it
 * had no failure path.
 */
describe('mentions', () => {
  it('matches the exact term and a simple plural', () => {
    expect(mentions('the parking spot is free', 'spot')).toBe(true);
    expect(mentions('the parking spots are free', 'spot')).toBe(true);
  });

  it('matches a short inflection of a longer term', () => {
    expect(mentions('requests arrive concurrently', 'concurrent')).toBe(true);
    expect(mentions('the call is reassigned to another car', 'reassign')).toBe(true);
    expect(mentions('the strategy was selected', 'strategy')).toBe(true);
  });

  it('keeps short terms strict, so common words do not collide', () => {
    expect(mentions('the lot is fully booked', 'full')).toBe(false);
    expect(mentions('the lot is full', 'full')).toBe(true);
    expect(mentions('evening tariff', 'ev')).toBe(false);
  });

  it('does not match a term that only appears as the tail of another word', () => {
    // The leading word boundary is what stops substring noise.
    expect(mentions('they hit the jackpot', 'spot')).toBe(false);
    expect(mentions('unparking is not parking', 'parking')).toBe(true);
  });

  it('does accept a derived form as evidence, which is the intended trade', () => {
    // The suffix allowance cuts both ways: "ticketing" counts as evidence of
    // ticketing, which is wanted, and there is no way to permit "concurrently"
    // while forbidding this. Deliberate, and the reason findings are phrased as
    // questions and shown with the matched evidence attached.
    expect(mentions('the ticketing subsystem', 'ticket')).toBe(true);
  });

  it('matches multi-word terms across flexible whitespace', () => {
    expect(mentions('records the entry   time', 'entry time')).toBe(true);
  });
});

describe('buildSearchText', () => {
  const model = {
    entities: [
      {
        name: 'ElevatorController',
        kind: 'class' as const,
        responsibility: 'Assigns calls to cars',
        members: ['onCarUnavailable(car)', 'find_next_stop()'],
      },
    ],
    relationships: [],
    operations: [],
    narrative: 'Uses a PricingStrategy for rates.',
  };

  it('makes words inside camelCase identifiers findable', () => {
    const text = buildSearchText(model);
    expect(mentions(text, 'unavailable')).toBe(true);
    expect(mentions(text, 'elevator')).toBe(true);
  });

  it('makes words inside snake_case identifiers findable', () => {
    expect(mentions(buildSearchText(model), 'next stop')).toBe(true);
  });

  it('keeps the verbatim form too, so concatenated aliases still match', () => {
    // Concept aliases are authored as single words (`pricingstrategy`), so
    // splitting alone would have broken every one of them.
    const text = buildSearchText(model);
    expect(mentions(text, 'pricingstrategy')).toBe(true);
    expect(mentions(text, 'oncarunavailable')).toBe(true);
  });
});

describe('concept ownership', () => {
  const pipeline = new EvaluationPipeline(new DeterministicEvaluator(), [], new FakeClock());
  const normalizer = new StructuredNormalizer();
  const problem = seedProblems().find((p) => p.slug === 'parking-lot')!;

  async function abstractionScoreFor(entities: Array<{ name: string; members: string[] }>) {
    const submission = {
      format: 'structured' as const,
      entities: entities.map((e) => ({
        name: e.name,
        kind: 'class' as const,
        responsibility: `Handles ${e.name} concerns for the lot`,
        members: e.members,
      })),
      relationships: [
        { from: entities[0]!.name, to: entities[1]?.name ?? entities[0]!.name, kind: 'association', cardinality: '1..*' },
      ],
      operations: [],
      tradeoffs: '',
      assumptions: '',
    };
    const result = await pipeline.run({
      problem,
      submission,
      design: normalizer.normalize(submission),
      attemptNumber: 1,
      previousScore: null,
    });
    return result.dimensionScores.find((d) => d.dimension === 'abstraction_quality')?.score ?? 0;
  }

  it('credits a dedicated type more than the same concept folded into a god class', async () => {
    const folded = await abstractionScoreFor([
      { name: 'ParkingLotManager', members: ['calculateFee()', 'findSpot()', 'issueTicket()', 'processPayment()'] },
      { name: 'Car', members: ['plate'] },
    ]);

    const dedicated = await abstractionScoreFor([
      { name: 'PricingStrategy', members: ['priceFor(ticket)'] },
      { name: 'AllocationStrategy', members: ['allocate(vehicle)'] },
      { name: 'ParkingTicket', members: ['entryTime'] },
      { name: 'PaymentGateway', members: ['charge(amount)'] },
      { name: 'ParkingSpot', members: ['size'] },
    ]);

    // Naming the concepts is not the same as modelling them. Before this
    // distinction existed, both of these scored the same.
    expect(dedicated).toBeGreaterThan(folded + 15);
  });

  it('does not treat a folded concept as absent, it is worth partial credit', async () => {
    const folded = await abstractionScoreFor([
      { name: 'ParkingLotManager', members: ['calculateFee()', 'findSpot()', 'issueTicket()', 'processPayment()'] },
      { name: 'Car', members: ['plate'] },
    ]);
    const nothing = await abstractionScoreFor([
      { name: 'Thing', members: ['doStuff()'] },
      { name: 'OtherThing', members: ['doMore()'] },
    ]);

    // Folding a concept in can be a legitimate decision; scoring it as though
    // the concept were missing would assert one correct decomposition.
    expect(folded).toBeGreaterThan(nothing);
  });
});

import type { Clock } from '../src/domain/shared/ids.js';
import type { StructuredSubmission, Submission } from '../src/domain/attempt/Submission.js';
import { seedProblems } from '../src/infrastructure/seed/problems.js';
import type { Problem } from '../src/domain/problem/Problem.js';
import type { LlmClient, LlmRequest } from '../src/evaluation/llm/LlmClient.js';

export function problemBySlug(slug: string): Problem {
  const problem = seedProblems().find((p) => p.slug === slug);
  if (!problem) throw new Error(`No seeded problem '${slug}'`);
  return problem;
}

/** A clock the tests advance by hand, so nothing depends on wall time. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start = new Date('2026-01-01T10:00:00.000Z')) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** An LLM that returns whatever the test tells it to, including failures. */
export class ScriptedLlmClient implements LlmClient {
  readonly modelId = 'scripted-test-model';
  readonly requests: LlmRequest[] = [];
  private readonly responses: Array<string | Error>;

  constructor(responses: Array<string | Error>) {
    this.responses = [...responses];
  }

  async complete(request: LlmRequest): Promise<string> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (next === undefined) throw new Error('ScriptedLlmClient ran out of responses');
    if (next instanceof Error) throw next;
    return next;
  }
}

export function validLlmResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: 'A solid first pass. Pull pricing out of Ticket and this is interview-ready.',
    dimensions: [
      { dimension: 'abstraction_quality', score: 70, rationale: 'Responsibilities are mostly single.' },
      { dimension: 'relationships', score: 65, rationale: 'Cardinality stated on the important links.' },
      { dimension: 'extensibility', score: 60, rationale: 'One seam, could use another.' },
      { dimension: 'edge_cases', score: 50, rationale: 'Full-lot handled, contention is not.' },
      { dimension: 'tradeoff_reasoning', score: 55, rationale: 'Reasoning present but brief.' },
    ],
    feedback: [
      {
        kind: 'strength',
        dimension: 'abstraction_quality',
        title: 'PricingStrategy isolates the rate rules',
        detail: 'Keeping the rate card outside Ticket means a new tariff is a new class.',
      },
      {
        kind: 'gap',
        dimension: 'edge_cases',
        title: 'Nothing guards the last free spot',
        detail: 'Two vehicles can both be issued a ticket for the same spot.',
      },
    ],
    ...overrides,
  });
}

/** A deliberately strong parking-lot design, used as the "good" baseline. */
export function strongParkingLotSubmission(): StructuredSubmission {
  return {
    format: 'structured',
    entities: [
      { name: 'ParkingLot', kind: 'class', responsibility: 'Aggregate root that owns the floors and coordinates entry and exit', members: ['park(vehicle)', 'unpark(ticket)'] },
      { name: 'ParkingFloor', kind: 'class', responsibility: 'Holds the spots on one level and reports which are available', members: ['findAvailable(size)'] },
      { name: 'ParkingSpot', kind: 'class', responsibility: 'A single allocatable space with a size and current occupant', members: ['size', 'currentTicket', 'hasCharger'] },
      { name: 'Vehicle', kind: 'class', responsibility: 'The vehicle being parked, knowing its plate and size class', members: ['licensePlate', 'size', 'isElectric'] },
      { name: 'ParkingTicket', kind: 'class', responsibility: 'Records which vehicle holds which spot and the entry time', members: ['entryTime', 'spot', 'vehicle'] },
      { name: 'PricingStrategy', kind: 'interface', responsibility: 'Computes the fee owed for a completed stay', members: ['priceFor(ticket, exitTime)'] },
      { name: 'AllocationStrategy', kind: 'interface', responsibility: 'Chooses which free spot a vehicle should be given', members: ['allocate(vehicle, floors)'] },
      { name: 'PaymentGateway', kind: 'interface', responsibility: 'Boundary to the external payment provider', members: ['charge(amount)'] },
    ],
    relationships: [
      { from: 'ParkingLot', to: 'ParkingFloor', kind: 'composition', cardinality: '1..*' },
      { from: 'ParkingFloor', to: 'ParkingSpot', kind: 'composition', cardinality: '1..*' },
      { from: 'ParkingTicket', to: 'ParkingSpot', kind: 'association', cardinality: '1..1' },
      { from: 'ParkingTicket', to: 'Vehicle', kind: 'association', cardinality: '1..1' },
      { from: 'ParkingLot', to: 'PricingStrategy', kind: 'association', cardinality: '1..1' },
      { from: 'ParkingLot', to: 'AllocationStrategy', kind: 'association', cardinality: '1..1' },
      { from: 'ParkingLot', to: 'PaymentGateway', kind: 'dependency', cardinality: '1..1' },
    ],
    operations: [
      { name: 'park', owner: 'ParkingLot', description: 'Allocates a spot that fits the vehicle size and issues a ticket; rejects when the lot is full' },
      { name: 'unpark', owner: 'ParkingLot', description: 'Prices the stay, takes payment, releases the spot' },
    ],
    tradeoffs:
      'I put pricing behind a PricingStrategy interface rather than a method on Ticket because rate cards change far more often than the domain does — an EV discount or a night tariff becomes a new class instead of an edit to Ticket. I chose composition over inheritance for spot sizes: a spot that fits a compact car is a property, not a subtype, and modelling it as a subtype would have made a spot that changes size class impossible. The cost is one more indirection when reading the code. Allocation is a separate strategy for the same reason; nearest-to-entrance and floor-fill are both reasonable and lots switch between them. Spot allocation takes a lock on the spot so two concurrent arrivals cannot both be issued a ticket for the last free spot.',
    assumptions:
      'A single physical lot. Payment is taken at exit through an external gateway, which I have kept behind an interface so the domain stays testable. If the lot is full the park operation returns an explicit LotFull error rather than throwing an invalid ticket.',
  };
}

/** A deliberately weak design: nouns only, no reasoning, no failure paths. */
export function weakParkingLotSubmission(): StructuredSubmission {
  return {
    format: 'structured',
    entities: [
      { name: 'ParkingLotManager', kind: 'class', responsibility: 'Manages the whole parking lot system', members: ['park()', 'unpark()', 'calculateFee()', 'processPayment()', 'findSpot()', 'addFloor()', 'removeFloor()', 'getReport()', 'validateTicket()', 'assignSpot()'] },
      { name: 'Car', kind: 'class', responsibility: 'A car in the lot', members: ['plate'] },
    ],
    relationships: [{ from: 'ParkingLotManager', to: 'Car', kind: 'has' }],
    operations: [],
    tradeoffs: '',
    assumptions: '',
  };
}

export function submissionWith(overrides: Partial<StructuredSubmission>): Submission {
  return { ...strongParkingLotSubmission(), ...overrides };
}

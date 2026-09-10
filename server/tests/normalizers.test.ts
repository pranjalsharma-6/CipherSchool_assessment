import { describe, expect, it } from 'vitest';
import { CodeNormalizer } from '../src/evaluation/normalizers/CodeNormalizer.js';
import { DiagramNormalizer } from '../src/evaluation/normalizers/DiagramNormalizer.js';
import { StructuredNormalizer } from '../src/evaluation/normalizers/StructuredNormalizer.js';
import { SubmissionNormalizerRegistry } from '../src/evaluation/normalizers/SubmissionNormalizer.js';
import { ValidationError } from '../src/domain/shared/errors.js';
import { strongParkingLotSubmission } from './fixtures.js';

describe('StructuredNormalizer', () => {
  it('maps the form onto the design model and normalises relationship words', () => {
    const design = new StructuredNormalizer().normalize({
      ...strongParkingLotSubmission(),
      relationships: [
        { from: 'Lot', to: 'Floor', kind: 'owns', cardinality: '1..*' },
        { from: 'Ticket', to: 'Spot', kind: 'has-a' },
        { from: 'EvSpot', to: 'Spot', kind: 'extends' },
      ],
    });

    expect(design.relationships.map((r) => r.kind)).toEqual([
      'composition',
      'association',
      'inheritance',
    ]);
    expect(design.searchText).toContain('pricingstrategy');
  });
});

describe('CodeNormalizer', () => {
  const normalizer = new CodeNormalizer();

  it('extracts classes, interfaces, inheritance and collection cardinality from TypeScript', () => {
    const design = normalizer.normalize({
      format: 'code',
      language: 'typescript',
      tradeoffs: 'Strategy keeps pricing swappable.',
      source: `
        interface PricingStrategy {
          priceFor(ticket: ParkingTicket): number;
        }

        class HourlyPricing implements PricingStrategy {
          priceFor(ticket: ParkingTicket): number { return 10; }
        }

        class ParkingLot {
          private floors: ParkingFloor[] = [];
          private pricing: PricingStrategy;
          park(vehicle: Vehicle): ParkingTicket { throw new Error('todo'); }
        }

        class ParkingFloor {}
        class ParkingTicket {}
        class Vehicle {}
      `,
    });

    const names = design.entities.map((e) => e.name);
    expect(names).toContain('PricingStrategy');
    expect(names).toContain('ParkingLot');
    expect(design.entities.find((e) => e.name === 'PricingStrategy')?.kind).toBe('interface');

    expect(design.relationships).toContainEqual(
      expect.objectContaining({ from: 'HourlyPricing', to: 'PricingStrategy', kind: 'implements' }),
    );
    expect(design.relationships).toContainEqual(
      expect.objectContaining({ from: 'ParkingLot', to: 'ParkingFloor', cardinality: '1..*' }),
    );
    expect(design.operations.some((o) => o.name === 'park')).toBe(true);
  });

  it('handles Java inheritance and ignores commented-out code', () => {
    const design = normalizer.normalize({
      format: 'code',
      language: 'java',
      tradeoffs: '',
      source: `
        // class GhostClass {}
        /* class AnotherGhost {} */
        public abstract class Vehicle {
          public abstract int getSize();
        }
        public class Car extends Vehicle {
          public int getSize() { return 1; }
        }
      `,
    });

    expect(design.entities.map((e) => e.name)).toEqual(['Vehicle', 'Car']);
    expect(design.relationships).toContainEqual(
      expect.objectContaining({ from: 'Car', to: 'Vehicle', kind: 'inheritance' }),
    );
  });

  it('parses Python classes without braces', () => {
    const design = normalizer.normalize({
      format: 'code',
      language: 'python',
      tradeoffs: '',
      source: [
        'class Vehicle:',
        '    def size(self):',
        '        return 1',
        '',
        'class Car(Vehicle):',
        '    def size(self):',
        '        return 2',
      ].join('\n'),
    });

    expect(design.entities.map((e) => e.name)).toEqual(['Vehicle', 'Car']);
    expect(design.entities.find((e) => e.name === 'Car')?.members).toContain('size');
  });

  it('returns an empty model rather than throwing on source it cannot parse', () => {
    const design = normalizer.normalize({
      format: 'code',
      language: 'typescript',
      tradeoffs: '',
      source: 'const x = 1; // no classes here at all',
    });

    expect(design.entities).toEqual([]);
    expect(design.searchText).toContain('no classes here');
  });
});

describe('DiagramNormalizer', () => {
  const normalizer = new DiagramNormalizer();

  it('reads arrow direction, kind and cardinality out of a Mermaid class diagram', () => {
    const design = normalizer.normalize({
      format: 'diagram',
      tradeoffs: 'Composition because a floor cannot outlive its lot.',
      source: `
        classDiagram
          class ParkingLot {
            +park(Vehicle) ParkingTicket
            +unpark(ParkingTicket) Money
          }
          class PricingStrategy {
            <<interface>>
            +priceFor(ticket) Money
          }
          ParkingLot "1" *-- "1..*" ParkingFloor : owns
          ParkingFloor "1" o-- "0..*" ParkingSpot
          HourlyPricing ..|> PricingStrategy
          Vehicle <|-- Car
      `,
    });

    expect(design.entities.find((e) => e.name === 'PricingStrategy')?.kind).toBe('interface');
    expect(design.operations.map((o) => o.name)).toContain('park');

    expect(design.relationships).toContainEqual(
      expect.objectContaining({
        from: 'ParkingLot',
        to: 'ParkingFloor',
        kind: 'composition',
        cardinality: '1 .. 1..*',
        note: 'owns',
      }),
    );
    expect(design.relationships).toContainEqual(
      expect.objectContaining({ from: 'ParkingFloor', to: 'ParkingSpot', kind: 'aggregation' }),
    );
    // `..|>` points implementation → interface; `<|--` points parent ← child.
    expect(design.relationships).toContainEqual(
      expect.objectContaining({ from: 'HourlyPricing', to: 'PricingStrategy', kind: 'implements' }),
    );
    expect(design.relationships).toContainEqual(
      expect.objectContaining({ from: 'Car', to: 'Vehicle', kind: 'inheritance' }),
    );
  });
});

describe('SubmissionNormalizerRegistry', () => {
  it('routes each format to its normaliser', () => {
    const registry = new SubmissionNormalizerRegistry([
      new StructuredNormalizer(),
      new CodeNormalizer(),
      new DiagramNormalizer(),
    ]);

    expect(registry.normalize(strongParkingLotSubmission()).entities.length).toBeGreaterThan(0);
    expect(registry.supports('diagram')).toBe(true);
  });

  it('fails loudly for a format with no normaliser registered', () => {
    const registry = new SubmissionNormalizerRegistry([new StructuredNormalizer()]);

    expect(() =>
      registry.normalize({ format: 'diagram', source: 'classDiagram', tradeoffs: '' }),
    ).toThrow(ValidationError);
  });
});

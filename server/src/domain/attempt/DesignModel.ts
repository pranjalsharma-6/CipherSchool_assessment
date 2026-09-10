/**
 * The normalised intermediate representation every evaluator reads.
 *
 * This type is the reason the platform can accept more than one submission
 * format without touching the evaluators. A structured form, a Mermaid class
 * diagram and a TypeScript file are three different things to a learner, but
 * once normalised they are all "some classes, some relationships, some
 * operations, and some prose about why". Evaluators depend on this — never on
 * the raw submission — so adding a format is one new normaliser and zero
 * changes to scoring.
 */
export interface DesignModel {
  readonly entities: readonly DesignEntity[];
  readonly relationships: readonly DesignRelationship[];
  readonly operations: readonly DesignOperation[];
  /** Trade-offs, assumptions, and any other free prose the learner wrote. */
  readonly narrative: string;
  /** Everything above flattened to lower-case text, for signal matching. */
  readonly searchText: string;
}

export interface DesignEntity {
  readonly name: string;
  readonly kind: 'class' | 'interface' | 'enum' | 'unknown';
  readonly responsibility: string;
  readonly members: readonly string[];
}

export type RelationshipKind =
  | 'association'
  | 'aggregation'
  | 'composition'
  | 'inheritance'
  | 'implements'
  | 'dependency';

export interface DesignRelationship {
  readonly from: string;
  readonly to: string;
  readonly kind: RelationshipKind;
  /** e.g. "1..*" — free text, since learners write cardinality many ways. */
  readonly cardinality?: string;
  readonly note?: string;
}

export interface DesignOperation {
  readonly name: string;
  readonly owner?: string;
  readonly description: string;
}

export const EMPTY_DESIGN_MODEL: DesignModel = {
  entities: [],
  relationships: [],
  operations: [],
  narrative: '',
  searchText: '',
};

/** Builds the flattened lower-case blob used for signal/alias matching. */
export function buildSearchText(
  model: Omit<DesignModel, 'searchText'>,
  extra: readonly string[] = [],
): string {
  const parts: string[] = [model.narrative, ...extra];
  for (const e of model.entities) {
    parts.push(e.name, e.kind, e.responsibility, ...e.members);
  }
  for (const r of model.relationships) {
    parts.push(r.from, r.to, r.kind, r.cardinality ?? '', r.note ?? '');
  }
  for (const o of model.operations) {
    parts.push(o.name, o.owner ?? '', o.description);
  }
  return parts.join('\n').toLowerCase();
}

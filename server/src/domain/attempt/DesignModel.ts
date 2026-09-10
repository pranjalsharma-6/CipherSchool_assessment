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
  // Identifiers carry real signal — `onCarUnavailable` says something about the
  // design — but lower-cased they become one blob that word-boundary matching
  // cannot see into. So the text carries the design twice: once verbatim, so
  // concatenated aliases like `pricingstrategy` still match, and once with
  // identifiers split into words, so `unavailable` matches too. Both forms are
  // needed; either alone misses signals the other finds.
  const verbatim = parts.join('\n');
  return `${verbatim}\n${splitIdentifiers(verbatim)}`.toLowerCase();
}

/** `onCarUnavailable` → `on Car Unavailable`; `find_spot` → `find spot`. */
function splitIdentifiers(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_]+/g, ' ');
}

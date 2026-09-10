import {
  buildSearchText,
  type DesignModel,
  type RelationshipKind,
} from '../../domain/attempt/DesignModel.js';
import type { StructuredSubmission } from '../../domain/attempt/Submission.js';
import type { SubmissionNormalizer } from './SubmissionNormalizer.js';

const KIND_ALIASES: Record<string, RelationshipKind> = {
  association: 'association',
  associates: 'association',
  has: 'association',
  'has-a': 'association',
  uses: 'dependency',
  dependency: 'dependency',
  depends: 'dependency',
  aggregation: 'aggregation',
  aggregates: 'aggregation',
  composition: 'composition',
  composes: 'composition',
  'owns': 'composition',
  'contains': 'composition',
  inheritance: 'inheritance',
  extends: 'inheritance',
  'is-a': 'inheritance',
  implements: 'implements',
  realizes: 'implements',
};

/** The near-identity case: the structured form already *is* the design model. */
export class StructuredNormalizer implements SubmissionNormalizer<'structured'> {
  readonly format = 'structured' as const;

  normalize(submission: StructuredSubmission): DesignModel {
    const base = {
      entities: submission.entities.map((e) => ({
        name: e.name.trim(),
        kind: e.kind,
        responsibility: e.responsibility.trim(),
        members: e.members.map((m) => m.trim()).filter(Boolean),
      })),
      relationships: submission.relationships.map((r) => ({
        from: r.from.trim(),
        to: r.to.trim(),
        kind: KIND_ALIASES[r.kind.trim().toLowerCase()] ?? 'association',
        cardinality: r.cardinality?.trim(),
        note: r.note?.trim(),
      })),
      operations: submission.operations.map((o) => ({
        name: o.name.trim(),
        owner: o.owner?.trim(),
        description: o.description.trim(),
      })),
      narrative: [submission.tradeoffs, submission.assumptions]
        .filter((s) => s && s.trim().length > 0)
        .join('\n\n'),
    };
    return { ...base, searchText: buildSearchText(base) };
  }
}

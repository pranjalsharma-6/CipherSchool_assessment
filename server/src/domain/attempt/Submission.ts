import { ValidationError } from '../shared/errors.js';

/**
 * What a learner hands in.
 *
 * The MVP takes the position that free prose is the wrong primary format: it
 * is pleasant to write, impossible to give precise feedback on, and it lets a
 * learner skip the parts of LLD that are actually hard (naming owners, fixing
 * cardinality). So the primary format is *structured*, you must name your
 * classes and say what each one is responsible for, with code and diagram
 * accepted as alternatives for learners who think better that way.
 *
 * A discriminated union rather than a class hierarchy: submissions are inert
 * data that crosses the wire and the database, and behaviour lives in the
 * normalisers that read them.
 */
export type Submission = StructuredSubmission | CodeSubmission | DiagramSubmission;

export type SubmissionFormat = Submission['format'];

export const SUBMISSION_FORMATS: readonly SubmissionFormat[] = ['structured', 'code', 'diagram'];

export interface StructuredSubmission {
  readonly format: 'structured';
  readonly entities: readonly StructuredEntity[];
  readonly relationships: readonly StructuredRelationship[];
  readonly operations: readonly StructuredOperation[];
  /** Why this shape and not another: the part interviewers actually probe. */
  readonly tradeoffs: string;
  readonly assumptions: string;
}

export interface StructuredEntity {
  readonly name: string;
  readonly kind: 'class' | 'interface' | 'enum';
  readonly responsibility: string;
  readonly members: readonly string[];
}

export interface StructuredRelationship {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly cardinality?: string;
  readonly note?: string;
}

export interface StructuredOperation {
  readonly name: string;
  readonly owner?: string;
  readonly description: string;
}

export interface CodeSubmission {
  readonly format: 'code';
  readonly language: 'typescript' | 'java' | 'python';
  readonly source: string;
  readonly tradeoffs: string;
}

export interface DiagramSubmission {
  readonly format: 'diagram';
  /** Mermaid `classDiagram` source. */
  readonly source: string;
  readonly tradeoffs: string;
}

/**
 * Guards that a submission carries enough substance to be worth evaluating.
 *
 * This runs before the attempt leaves DRAFT. Rejecting a near-empty design at
 * the door is kinder than spending an LLM call to tell the learner they wrote
 * nothing, and it keeps meaningless attempts out of the progress history.
 */
export function assertSubmittable(submission: Submission): void {
  const problems: string[] = [];

  switch (submission.format) {
    case 'structured': {
      if (submission.entities.length < 2) {
        problems.push('Describe at least two classes or interfaces.');
      }
      const unnamed = submission.entities.filter((e) => e.name.trim().length === 0);
      if (unnamed.length > 0) problems.push('Every class needs a name.');
      const undescribed = submission.entities.filter(
        (e) => e.responsibility.trim().length < 10,
      );
      if (undescribed.length > 0) {
        problems.push(
          `Give a one-line responsibility for: ${undescribed
            .map((e) => e.name || '(unnamed)')
            .join(', ')}.`,
        );
      }
      if (submission.relationships.length < 1) {
        problems.push('Describe at least one relationship between your classes.');
      }
      break;
    }
    case 'code': {
      if (submission.source.trim().length < 120) {
        problems.push('The code submission looks too short to evaluate.');
      }
      break;
    }
    case 'diagram': {
      if (!/classDiagram/i.test(submission.source)) {
        problems.push('The diagram must be a Mermaid `classDiagram`.');
      }
      if (submission.source.trim().length < 60) {
        problems.push('The diagram looks too short to evaluate.');
      }
      break;
    }
  }

  if (problems.length > 0) {
    throw new ValidationError('This submission is not ready to evaluate yet', problems);
  }
}

import { z } from 'zod';
import type { Submission } from '../../domain/attempt/Submission.js';
import { ValidationError } from '../../domain/shared/errors.js';

/**
 * The trust boundary.
 *
 * Everything crossing it is parsed into a domain type here, once, so the
 * domain and application layers can assume their inputs are well formed and
 * spend their code on rules rather than on defensive checks.
 */
const structuredSchema = z.object({
  format: z.literal('structured'),
  entities: z
    .array(
      z.object({
        name: z.string().max(80),
        kind: z.enum(['class', 'interface', 'enum']),
        responsibility: z.string().max(500).default(''),
        members: z.array(z.string().max(200)).max(40).default([]),
      }),
    )
    .max(40),
  relationships: z
    .array(
      z.object({
        from: z.string().max(80),
        to: z.string().max(80),
        kind: z.string().max(40),
        cardinality: z.string().max(40).optional(),
        note: z.string().max(300).optional(),
      }),
    )
    .max(80),
  operations: z
    .array(
      z.object({
        name: z.string().max(120),
        owner: z.string().max(80).optional(),
        description: z.string().max(500).default(''),
      }),
    )
    .max(60)
    .default([]),
  tradeoffs: z.string().max(6000).default(''),
  assumptions: z.string().max(4000).default(''),
});

const codeSchema = z.object({
  format: z.literal('code'),
  language: z.enum(['typescript', 'java', 'python']),
  source: z.string().max(60_000),
  tradeoffs: z.string().max(6000).default(''),
});

const diagramSchema = z.object({
  format: z.literal('diagram'),
  source: z.string().max(30_000),
  tradeoffs: z.string().max(6000).default(''),
});

export const submissionSchema = z.discriminatedUnion('format', [
  structuredSchema,
  codeSchema,
  diagramSchema,
]);

export function parseSubmission(input: unknown): Submission {
  const result = submissionSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      'The submission body is malformed',
      result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    );
  }
  return result.data as Submission;
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      'Request body is malformed',
      result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    );
  }
  return result.data;
}

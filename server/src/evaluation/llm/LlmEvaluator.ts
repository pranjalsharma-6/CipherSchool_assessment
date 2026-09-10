import { z } from 'zod';
import type { FeedbackItem } from '../../domain/evaluation/Evaluation.js';
import {
  RetryableEvaluationError,
  clampScore,
  type DimensionAssessment,
  type EvaluationContext,
  type EvaluationContribution,
  type Evaluator,
} from '../Evaluator.js';
import { LlmUnavailableError, type LlmClient } from './LlmClient.js';
import { LLM_DIMENSIONS, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

const ResponseSchema = z.object({
  summary: z.string().min(1),
  dimensions: z
    .array(
      z.object({
        dimension: z.enum(LLM_DIMENSIONS),
        score: z.number(),
        rationale: z.string().default(''),
      }),
    )
    .min(1),
  feedback: z
    .array(
      z.object({
        kind: z.enum(['strength', 'gap', 'suggestion', 'question']),
        dimension: z.enum(LLM_DIMENSIONS),
        title: z.string().min(1),
        detail: z.string().min(1),
      }),
    )
    .default([]),
});

export interface LlmEvaluatorOptions {
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}

/**
 * The qualitative half of the pipeline.
 *
 * It is given the deterministic findings up front and told not to repeat them,
 * so the two halves compose into one review instead of two overlapping ones.
 * It judges only the dimensions where taste is required — how good the
 * abstractions are, whether the reasoning holds — and never re-litigates
 * requirement coverage, which a rule already answers exactly.
 */
export class LlmEvaluator implements Evaluator {
  readonly name = 'llm-reviewer';
  readonly source = 'llm' as const;
  readonly version: string;

  private readonly options: Required<LlmEvaluatorOptions>;

  constructor(
    private readonly client: LlmClient,
    /** The deterministic result, needed to build the prompt. */
    private readonly deterministicResult: () => EvaluationContribution,
    options: LlmEvaluatorOptions = {},
  ) {
    this.version = `1.0.0/${client.modelId}`;
    this.options = {
      maxTokens: options.maxTokens ?? 2000,
      // Near-zero: the same design resubmitted should get the same review, or
      // the score history the whole product is built around means nothing.
      temperature: options.temperature ?? 0.1,
      timeoutMs: options.timeoutMs ?? 45_000,
    };
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationContribution> {
    const raw = await this.call(context);
    const parsed = this.parse(raw);

    const dimensions: DimensionAssessment[] = parsed.dimensions.map((d) => ({
      dimension: d.dimension,
      score: clampScore(d.score),
      rationale: d.rationale,
    }));

    const feedback: FeedbackItem[] = parsed.feedback.map((f, index) => ({
      id: `llm-${index}`,
      kind: f.kind,
      dimension: f.dimension,
      title: f.title,
      detail: f.detail,
      source: this.source,
    }));

    return { source: this.source, dimensions, feedback, summary: parsed.summary };
  }

  private async call(context: EvaluationContext): Promise<string> {
    try {
      return await this.client.complete({
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt(context, this.deterministicResult()),
        maxTokens: this.options.maxTokens,
        temperature: this.options.temperature,
        timeoutMs: this.options.timeoutMs,
      });
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        throw new RetryableEvaluationError(error.message, error);
      }
      throw error;
    }
  }

  /**
   * Models sometimes wrap JSON in prose or a fence despite being asked not to,
   * so the first balanced object in the response is extracted rather than
   * trusting the whole body. A response that still will not parse — or that
   * parses into the wrong shape — is treated as retryable: at temperature 0.1
   * a re-ask usually succeeds, and if it does not, the pipeline degrades to
   * deterministic-only rather than failing the learner's submission.
   */
  private parse(raw: string): z.infer<typeof ResponseSchema> {
    const json = extractJsonObject(raw);
    if (!json) {
      throw new RetryableEvaluationError('Model response contained no JSON object');
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(json);
    } catch (error) {
      throw new RetryableEvaluationError('Model response was not valid JSON', error);
    }

    const result = ResponseSchema.safeParse(candidate);
    if (!result.success) {
      throw new RetryableEvaluationError(
        `Model response did not match the expected schema: ${result.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    return result.data;
  }
}

/** Scans for the first brace-balanced object, ignoring braces inside strings. */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

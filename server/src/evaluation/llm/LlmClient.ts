/**
 * The narrow slice of "a language model" this platform depends on.
 *
 * One method, plain strings in and out. Nothing above this line knows about
 * Anthropic, tokens, or SDK types, so swapping provider — or dropping in the
 * offline stub used by the tests and by a fresh checkout with no API key — is a
 * one-line change in the container.
 */
export interface LlmClient {
  readonly modelId: string;
  complete(request: LlmRequest): Promise<string>;
}

export interface LlmRequest {
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens: number;
  /** Low by default: two identical designs should not get different verdicts. */
  readonly temperature: number;
  readonly timeoutMs: number;
}

/** Thrown for transport-level problems that another attempt might survive. */
export class LlmUnavailableError extends Error {
  readonly retryable = true;

  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

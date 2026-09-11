import Anthropic from '@anthropic-ai/sdk';
import { LlmUnavailableError, type LlmClient, type LlmRequest } from './LlmClient.js';

/**
 * Anthropic-backed {@link LlmClient}.
 *
 * Every failure mode the SDK can produce is folded into either
 * {@link LlmUnavailableError} (retryable: rate limits, overloads, timeouts,
 * network) or a plain Error (not retryable: a bad request or a bad key, where
 * retrying just burns the learner's time). The pipeline above only has to
 * understand those two cases.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly modelId: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: LlmRequest): Promise<string> {
    try {
      const response = await this.client.messages.create(
        {
          model: this.modelId,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
        },
        { timeout: request.timeoutMs },
      );

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!text.trim()) throw new LlmUnavailableError('Model returned an empty response');
      return text;
    } catch (error) {
      if (error instanceof LlmUnavailableError) throw error;
      if (error instanceof Anthropic.APIError) {
        const retryable =
          error.status === undefined ||
          error.status === 408 ||
          error.status === 429 ||
          error.status >= 500;
        if (retryable) {
          throw new LlmUnavailableError(`Model call failed (${error.status ?? 'network'})`, error);
        }
        throw new Error(`Model rejected the request (${error.status}): ${error.message}`);
      }
      throw new LlmUnavailableError('Model call failed', error);
    }
  }
}

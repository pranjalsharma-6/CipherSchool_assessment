import 'dotenv/config';
import { z } from 'zod';

/**
 * Configuration is parsed once, at startup, into a frozen object.
 *
 * Nothing below this file reads `process.env`, so every dependency a component
 * has is visible in its constructor, which is what makes the whole system
 * constructible in a test with different settings and no environment juggling.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Absent → the in-memory attempt store. Present → MongoDB. */
  MONGODB_URI: z.string().min(1).optional(),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

  /**
   * auto    : use the real model when a key is present, otherwise the offline stand-in
   * anthropicrequire the real model; fail fast at startup if no key
   * offline : always the offline stand-in (used by the tests and by demos)
   * none    , no qualitative evaluator at all; every review is deterministic-only
   */
  REVIEWER_MODE: z.enum(['auto', 'anthropic', 'offline', 'none']).default('auto'),

  EVALUATION_CONCURRENCY: z.coerce.number().int().positive().default(2),
  EVALUATION_RETRY_BASE_MS: z.coerce.number().int().nonnegative().default(1000),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),

  CORS_ORIGIN: z.string().default('*'),
});

export type Config = Readonly<z.infer<typeof schema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const config = parsed.data;
  if (config.REVIEWER_MODE === 'anthropic' && !config.ANTHROPIC_API_KEY) {
    throw new Error('REVIEWER_MODE=anthropic requires ANTHROPIC_API_KEY to be set');
  }
  return Object.freeze(config);
}

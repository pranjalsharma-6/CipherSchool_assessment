import mongoose from 'mongoose';
import type { Config } from './config.js';
import { systemClock, type Clock } from './domain/shared/ids.js';
import { AttemptService } from './application/AttemptService.js';
import { EvaluationWorker, type EvaluationJob } from './application/EvaluationWorker.js';
import { InProcessJobQueue } from './application/queue/InProcessJobQueue.js';
import type { JobQueue } from './application/queue/JobQueue.js';
import type { AttemptRepository, ProblemRepository } from './application/ports.js';
import { EvaluationPipeline } from './evaluation/EvaluationPipeline.js';
import type { Evaluator, EvaluationContribution } from './evaluation/Evaluator.js';
import { DeterministicEvaluator } from './evaluation/deterministic/DeterministicEvaluator.js';
import { AnthropicLlmClient } from './evaluation/llm/AnthropicLlmClient.js';
import { LlmEvaluator } from './evaluation/llm/LlmEvaluator.js';
import { OfflineLlmClient } from './evaluation/llm/OfflineLlmClient.js';
import type { LlmClient } from './evaluation/llm/LlmClient.js';
import { CodeNormalizer } from './evaluation/normalizers/CodeNormalizer.js';
import { DiagramNormalizer } from './evaluation/normalizers/DiagramNormalizer.js';
import { StructuredNormalizer } from './evaluation/normalizers/StructuredNormalizer.js';
import { SubmissionNormalizerRegistry } from './evaluation/normalizers/SubmissionNormalizer.js';
import { InMemoryAttemptRepository } from './infrastructure/repositories/InMemoryAttemptRepository.js';
import { InMemoryProblemRepository } from './infrastructure/repositories/InMemoryProblemRepository.js';
import { MongoAttemptRepository } from './infrastructure/repositories/MongoAttemptRepository.js';
import { seedProblems } from './infrastructure/seed/problems.js';

export interface Container {
  readonly config: Config;
  readonly problems: ProblemRepository;
  readonly attempts: AttemptRepository;
  readonly attemptService: AttemptService;
  readonly queue: JobQueue<EvaluationJob>;
  readonly worker: EvaluationWorker;
  readonly reviewer: ReviewerInfo;
  shutdown(): Promise<void>;
}

/** Surfaced on `/api/health` so a demo shows which reviewer is actually wired. */
export interface ReviewerInfo {
  readonly mode: Config['REVIEWER_MODE'];
  readonly modelId: string | null;
  readonly simulated: boolean;
}

export interface ContainerOverrides {
  readonly clock?: Clock;
  readonly llmClient?: LlmClient | null;
  readonly logger?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Composition root.
 *
 * The only place in the codebase that decides which concrete adapter satisfies
 * which port. Every other module takes its collaborators through its
 * constructor, which is what makes "swap the database", "swap the model", and
 * "swap the queue" one-line changes here rather than an audit of the codebase.
 */
export async function createContainer(
  config: Config,
  overrides: ContainerOverrides = {},
): Promise<Container> {
  const clock = overrides.clock ?? systemClock;
  const log = overrides.logger ?? defaultLogger(config);

  const problems: ProblemRepository = new InMemoryProblemRepository(seedProblems());

  let connection: mongoose.Connection | null = null;
  let attempts: AttemptRepository;
  if (config.MONGODB_URI) {
    connection = await mongoose.createConnection(config.MONGODB_URI).asPromise();
    attempts = new MongoAttemptRepository(connection);
    log('storage.mongo_connected');
  } else {
    attempts = new InMemoryAttemptRepository();
    log('storage.in_memory', {
      note: 'attempts are not persisted across restarts; set MONGODB_URI to change this',
    });
  }

  const normalizers = new SubmissionNormalizerRegistry([
    new StructuredNormalizer(),
    new CodeNormalizer(),
    new DiagramNormalizer(),
  ]);

  const deterministic = new DeterministicEvaluator();

  // The LLM prompt embeds the deterministic findings so the two halves do not
  // overlap. The pipeline runs the baseline first, so by the time the reviewer
  // is asked for its prompt this holder is populated.
  let lastDeterministic: EvaluationContribution = {
    source: 'deterministic',
    dimensions: [],
    feedback: [],
  };
  const baseline: Evaluator = {
    name: deterministic.name,
    version: deterministic.version,
    source: deterministic.source,
    evaluate: async (context) => {
      lastDeterministic = await deterministic.evaluate(context);
      return lastDeterministic;
    },
  };

  const llmClient = resolveLlmClient(config, overrides);
  const optional: Evaluator[] = llmClient
    ? [
        new LlmEvaluator(llmClient, () => lastDeterministic, {
          timeoutMs: config.LLM_TIMEOUT_MS,
        }),
      ]
    : [];

  const pipeline = new EvaluationPipeline(baseline, optional, clock);

  const queue = new InProcessJobQueue<EvaluationJob>({
    concurrency: config.EVALUATION_CONCURRENCY,
    onError: (error) => log('queue.unhandled_error', { error: String(error) }),
  });

  const attemptService = new AttemptService(attempts, problems, queue, clock);

  const worker = new EvaluationWorker(
    queue,
    attempts,
    problems,
    normalizers,
    pipeline,
    attemptService,
    clock,
    { retryBaseMs: config.EVALUATION_RETRY_BASE_MS, logger: log },
  );
  worker.start();

  return {
    config,
    problems,
    attempts,
    attemptService,
    queue,
    worker,
    reviewer: {
      mode: config.REVIEWER_MODE,
      modelId: llmClient?.modelId ?? null,
      simulated: llmClient instanceof OfflineLlmClient,
    },
    async shutdown() {
      await queue.stop();
      if (connection) await connection.close();
    },
  };
}

function resolveLlmClient(config: Config, overrides: ContainerOverrides): LlmClient | null {
  if (overrides.llmClient !== undefined) return overrides.llmClient;

  switch (config.REVIEWER_MODE) {
    case 'none':
      return null;
    case 'offline':
      return new OfflineLlmClient();
    case 'anthropic':
      // `loadConfig` already guaranteed the key is present in this mode.
      return new AnthropicLlmClient(config.ANTHROPIC_API_KEY as string, config.ANTHROPIC_MODEL);
    case 'auto':
      return config.ANTHROPIC_API_KEY
        ? new AnthropicLlmClient(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL)
        : new OfflineLlmClient();
  }
}

function defaultLogger(config: Config) {
  return (message: string, meta?: Record<string, unknown>): void => {
    if (config.NODE_ENV === 'test') return;
    console.log(JSON.stringify({ at: new Date().toISOString(), message, ...meta }));
  };
}

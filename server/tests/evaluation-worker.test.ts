import { describe, expect, it } from 'vitest';
import { AttemptService } from '../src/application/AttemptService.js';
import { EvaluationWorker, type EvaluationJob } from '../src/application/EvaluationWorker.js';
import { InProcessJobQueue } from '../src/application/queue/InProcessJobQueue.js';
import { EvaluationPipeline } from '../src/evaluation/EvaluationPipeline.js';
import { DeterministicEvaluator } from '../src/evaluation/deterministic/DeterministicEvaluator.js';
import { LlmEvaluator } from '../src/evaluation/llm/LlmEvaluator.js';
import { LlmUnavailableError } from '../src/evaluation/llm/LlmClient.js';
import { StructuredNormalizer } from '../src/evaluation/normalizers/StructuredNormalizer.js';
import { SubmissionNormalizerRegistry } from '../src/evaluation/normalizers/SubmissionNormalizer.js';
import { InMemoryAttemptRepository } from '../src/infrastructure/repositories/InMemoryAttemptRepository.js';
import { InMemoryProblemRepository } from '../src/infrastructure/repositories/InMemoryProblemRepository.js';
import { seedProblems } from '../src/infrastructure/seed/problems.js';
import { LearnerId } from '../src/domain/shared/ids.js';
import type { Evaluator } from '../src/evaluation/Evaluator.js';
import { MAX_EVALUATION_RUNS } from '../src/domain/attempt/Attempt.js';
import {
  FakeClock,
  ScriptedLlmClient,
  strongParkingLotSubmission,
  validLlmResponse,
} from './fixtures.js';

const LEARNER = LearnerId('worker-learner');

function build(optional: Evaluator[]) {
  const clock = new FakeClock();
  const attempts = new InMemoryAttemptRepository();
  const problems = new InMemoryProblemRepository(seedProblems());
  const queue = new InProcessJobQueue<EvaluationJob>({ concurrency: 1 });
  const service = new AttemptService(attempts, problems, queue, clock);
  const pipeline = new EvaluationPipeline(new DeterministicEvaluator(), optional, clock);

  const worker = new EvaluationWorker(
    queue,
    attempts,
    problems,
    new SubmissionNormalizerRegistry([new StructuredNormalizer()]),
    pipeline,
    service,
    clock,
    { retryBaseMs: 0 },
  );
  worker.start();

  return { queue, service, attempts, clock };
}

const emptyDeterministic = () => ({
  source: 'deterministic' as const,
  dimensions: [],
  feedback: [],
});

describe('EvaluationWorker', () => {
  it('evaluates a queued attempt and records the score', async () => {
    const { queue, service } = build([]);

    const attempt = await service.start(LEARNER, 'parking-lot');
    await service.submit(attempt.id, LEARNER, strongParkingLotSubmission());
    await queue.drain();

    const evaluated = await service.get(attempt.id, LEARNER);
    expect(evaluated.status).toBe('evaluated');
    expect(evaluated.evaluation?.overallScore).toBeGreaterThan(0);
  });

  it('retries a transient model failure and succeeds on the next run', async () => {
    const client = new ScriptedLlmClient([
      new LlmUnavailableError('overloaded'),
      validLlmResponse(),
    ]);
    const { queue, service } = build([new LlmEvaluator(client, emptyDeterministic)]);

    const attempt = await service.start(LEARNER, 'parking-lot');
    await service.submit(attempt.id, LEARNER, strongParkingLotSubmission());
    await queue.drain();

    const evaluated = await service.get(attempt.id, LEARNER);
    // The pipeline treats the model as optional, so the first run still
    // completes — degraded — rather than costing the learner their submission.
    expect(evaluated.status).toBe('evaluated');
    expect(evaluated.evaluation?.degraded).toBe(true);
    expect(client.requests).toHaveLength(1);
  });

  it('retries when the whole evaluation fails, then gives up into `failed`', async () => {
    // An evaluator that is *not* optional: a broken baseline fails the run.
    let calls = 0;
    const brokenBaseline: Evaluator = {
      name: 'broken',
      version: '1',
      source: 'deterministic',
      evaluate: async () => {
        calls += 1;
        throw Object.assign(new Error('transient storage blip'), { retryable: true });
      },
    };

    const clock = new FakeClock();
    const attempts = new InMemoryAttemptRepository();
    const problems = new InMemoryProblemRepository(seedProblems());
    const queue = new InProcessJobQueue<EvaluationJob>({ concurrency: 1 });
    const service = new AttemptService(attempts, problems, queue, clock);
    const worker = new EvaluationWorker(
      queue,
      attempts,
      problems,
      new SubmissionNormalizerRegistry([new StructuredNormalizer()]),
      new EvaluationPipeline(brokenBaseline, [], clock),
      service,
      clock,
      { retryBaseMs: 0 },
    );
    worker.start();

    const attempt = await service.start(LEARNER, 'parking-lot');
    await service.submit(attempt.id, LEARNER, strongParkingLotSubmission());
    await queue.drain();

    const failed = await service.get(attempt.id, LEARNER);
    expect(calls).toBe(MAX_EVALUATION_RUNS);
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toContain('transient storage blip');
    // The design the learner wrote survives the failure.
    expect(failed.submission).not.toBeNull();
  });

  it('lets a learner re-run a failed evaluation to a successful result', async () => {
    let shouldFail = true;
    const flaky: Evaluator = {
      name: 'flaky',
      version: '1',
      source: 'deterministic',
      evaluate: async (context) => {
        if (shouldFail) throw new Error('permanently broken for now');
        return new DeterministicEvaluator().evaluate(context);
      },
    };

    const clock = new FakeClock();
    const attempts = new InMemoryAttemptRepository();
    const problems = new InMemoryProblemRepository(seedProblems());
    const queue = new InProcessJobQueue<EvaluationJob>({ concurrency: 1 });
    const service = new AttemptService(attempts, problems, queue, clock);
    new EvaluationWorker(
      queue,
      attempts,
      problems,
      new SubmissionNormalizerRegistry([new StructuredNormalizer()]),
      new EvaluationPipeline(flaky, [], clock),
      service,
      clock,
      { retryBaseMs: 0 },
    ).start();

    const attempt = await service.start(LEARNER, 'parking-lot');
    await service.submit(attempt.id, LEARNER, strongParkingLotSubmission());
    await queue.drain();
    expect((await service.get(attempt.id, LEARNER)).status).toBe('failed');

    shouldFail = false;
    await service.retryEvaluation(attempt.id, LEARNER);
    await queue.drain();

    const recovered = await service.get(attempt.id, LEARNER);
    expect(recovered.status).toBe('evaluated');
    expect(recovered.evaluation?.overallScore).toBeGreaterThan(0);
  });

  it('ignores a redelivered job for an attempt that already finished', async () => {
    const { queue, service } = build([]);

    const attempt = await service.start(LEARNER, 'parking-lot');
    await service.submit(attempt.id, LEARNER, strongParkingLotSubmission());
    await queue.drain();

    const first = await service.get(attempt.id, LEARNER);
    await queue.enqueue({ attemptId: attempt.id });
    await queue.drain();

    const second = await service.get(attempt.id, LEARNER);
    expect(second.status).toBe('evaluated');
    expect(second.evaluationRuns).toBe(first.evaluationRuns);
  });

  it('tells the reviewer what the learner scored last time', async () => {
    const client = new ScriptedLlmClient([validLlmResponse(), validLlmResponse()]);
    const { queue, service } = build([new LlmEvaluator(client, emptyDeterministic)]);

    const first = await service.start(LEARNER, 'parking-lot');
    await service.submit(first.id, LEARNER, strongParkingLotSubmission());
    await queue.drain();
    const firstScore = (await service.get(first.id, LEARNER)).evaluation?.overallScore;

    const second = await service.start(LEARNER, 'parking-lot');
    await service.submit(second.id, LEARNER, strongParkingLotSubmission());
    await queue.drain();

    expect(client.requests[1]?.prompt).toContain('attempt #2');
    expect(client.requests[1]?.prompt).toContain(`scored ${firstScore}/100`);
  });
});

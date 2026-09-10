import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createContainer, type Container } from '../src/container.js';
import { OfflineLlmClient } from '../src/evaluation/llm/OfflineLlmClient.js';
import type { LlmClient } from '../src/evaluation/llm/LlmClient.js';
import { strongParkingLotSubmission, weakParkingLotSubmission } from './fixtures.js';

const LEARNER = 'test-learner';

async function harness(llmClient: LlmClient | null = new OfflineLlmClient()) {
  const config = loadConfig({
    NODE_ENV: 'test',
    REVIEWER_MODE: 'offline',
    EVALUATION_RETRY_BASE_MS: '0',
  } as NodeJS.ProcessEnv);

  const container = await createContainer(config, { llmClient });
  return { container, app: createApp(container) };
}

/** Submits and waits for the queue to finish, rather than polling on a timer. */
async function submitAndSettle(
  app: Express,
  container: Container,
  attemptId: string,
  submission: unknown,
) {
  const response = await request(app)
    .post(`/api/attempts/${attemptId}/submit`)
    .set('x-learner-id', LEARNER)
    .send({ submission });

  await container.queue.drain();
  return response;
}

let open: Container | null = null;
afterEach(async () => {
  await open?.shutdown();
  open = null;
});

describe('practice loop end to end', () => {
  it('runs choose → attempt → submit → feedback → history', async () => {
    const { app, container } = await harness();
    open = container;

    const problems = await request(app).get('/api/problems').expect(200);
    expect(problems.body.problems.length).toBeGreaterThanOrEqual(4);

    const problem = await request(app).get('/api/problems/parking-lot').expect(200);
    expect(problem.body.problem.requirements.length).toBeGreaterThan(0);
    // The grading key must never reach the client.
    expect(JSON.stringify(problem.body)).not.toContain('signals');
    expect(JSON.stringify(problem.body)).not.toContain('pitfall');

    const started = await request(app)
      .post('/api/attempts')
      .set('x-learner-id', LEARNER)
      .send({ problemId: 'parking-lot' })
      .expect(200);

    const attemptId = started.body.attempt.id;
    expect(started.body.attempt.status).toBe('draft');
    expect(started.body.attempt.attemptNumber).toBe(1);

    await request(app)
      .put(`/api/attempts/${attemptId}/draft`)
      .set('x-learner-id', LEARNER)
      .send({ submission: strongParkingLotSubmission() })
      .expect(200);

    const submitted = await submitAndSettle(
      app,
      container,
      attemptId,
      strongParkingLotSubmission(),
    );
    expect(submitted.status).toBe(200);
    // Submission returns immediately; the score is not ready yet.
    expect(submitted.body.attempt.status).toBe('queued');
    expect(submitted.body.attempt.evaluation).toBeNull();

    const evaluated = await request(app)
      .get(`/api/attempts/${attemptId}`)
      .set('x-learner-id', LEARNER)
      .expect(200);

    expect(evaluated.body.attempt.status).toBe('evaluated');
    expect(evaluated.body.attempt.pending).toBe(false);
    expect(evaluated.body.attempt.evaluation.overallScore).toBeGreaterThan(0);
    expect(evaluated.body.attempt.evaluation.feedback.length).toBeGreaterThan(0);
    expect(evaluated.body.attempt.evaluation.requirementCoverage.length).toBeGreaterThan(0);

    const history = await request(app)
      .get('/api/attempts?problemId=parking-lot')
      .set('x-learner-id', LEARNER)
      .expect(200);

    expect(history.body.attempts).toHaveLength(1);
    expect(history.body.attempts[0].score).toBe(
      evaluated.body.attempt.evaluation.overallScore,
    );
  });

  it('numbers repeat attempts and keeps every one in history', async () => {
    const { app, container } = await harness();
    open = container;

    for (let i = 0; i < 3; i += 1) {
      const started = await request(app)
        .post('/api/attempts')
        .set('x-learner-id', LEARNER)
        .send({ problemId: 'parking-lot' });
      expect(started.body.attempt.attemptNumber).toBe(i + 1);

      await submitAndSettle(
        app,
        container,
        started.body.attempt.id,
        i === 0 ? weakParkingLotSubmission() : strongParkingLotSubmission(),
      );
    }

    const history = await request(app)
      .get('/api/attempts?problemId=parking-lot')
      .set('x-learner-id', LEARNER)
      .expect(200);

    expect(history.body.attempts).toHaveLength(3);
    const [newest, , oldest] = history.body.attempts;
    expect(newest.attemptNumber).toBe(3);
    // Improvement is visible across attempts — the point of the product.
    expect(newest.score).toBeGreaterThan(oldest.score);
  });

  it('keeps one learner from reading another learner\'s attempt', async () => {
    const { app, container } = await harness();
    open = container;

    const started = await request(app)
      .post('/api/attempts')
      .set('x-learner-id', LEARNER)
      .send({ problemId: 'parking-lot' });

    await request(app)
      .get(`/api/attempts/${started.body.attempt.id}`)
      .set('x-learner-id', 'someone-else')
      .expect(404);
  });
});

describe('failure and edge cases', () => {
  it('rejects a submission with too little substance and explains why', async () => {
    const { app, container } = await harness();
    open = container;

    const started = await request(app)
      .post('/api/attempts')
      .set('x-learner-id', LEARNER)
      .send({ problemId: 'parking-lot' });

    const response = await request(app)
      .post(`/api/attempts/${started.body.attempt.id}/submit`)
      .set('x-learner-id', LEARNER)
      .send({
        submission: {
          format: 'structured',
          entities: [{ name: 'Lot', kind: 'class', responsibility: 'does it', members: [] }],
          relationships: [],
          operations: [],
          tradeoffs: '',
          assumptions: '',
        },
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.length).toBeGreaterThan(0);

    // Still editable — nothing the learner typed is lost.
    const after = await request(app)
      .get(`/api/attempts/${started.body.attempt.id}`)
      .set('x-learner-id', LEARNER);
    expect(after.body.attempt.status).toBe('draft');
  });

  it('rejects a malformed submission body at the boundary', async () => {
    const { app, container } = await harness();
    open = container;

    const started = await request(app)
      .post('/api/attempts')
      .set('x-learner-id', LEARNER)
      .send({ problemId: 'parking-lot' });

    await request(app)
      .post(`/api/attempts/${started.body.attempt.id}/submit`)
      .set('x-learner-id', LEARNER)
      .send({ submission: { format: 'telepathy', vibes: 'good' } })
      .expect(422);
  });

  it('returns 409 when resubmitting an attempt that is already evaluated', async () => {
    const { app, container } = await harness();
    open = container;

    const started = await request(app)
      .post('/api/attempts')
      .set('x-learner-id', LEARNER)
      .send({ problemId: 'parking-lot' });

    await submitAndSettle(app, container, started.body.attempt.id, strongParkingLotSubmission());

    const again = await request(app)
      .post(`/api/attempts/${started.body.attempt.id}/submit`)
      .set('x-learner-id', LEARNER)
      .send({ submission: strongParkingLotSubmission() })
      .expect(409);

    expect(again.body.error.code).toBe('ILLEGAL_STATE_TRANSITION');
  });

  it('still returns a usable review when no reviewer model is configured', async () => {
    const { app, container } = await harness(null);
    open = container;

    const started = await request(app)
      .post('/api/attempts')
      .set('x-learner-id', LEARNER)
      .send({ problemId: 'parking-lot' });

    await submitAndSettle(app, container, started.body.attempt.id, strongParkingLotSubmission());

    const evaluated = await request(app)
      .get(`/api/attempts/${started.body.attempt.id}`)
      .set('x-learner-id', LEARNER)
      .expect(200);

    const { evaluation } = evaluated.body.attempt;
    expect(evaluated.body.attempt.status).toBe('evaluated');
    expect(evaluation.overallScore).toBeGreaterThan(0);
    expect(evaluation.feedback.length).toBeGreaterThan(0);
  });

  it('404s an unknown problem and an unknown attempt', async () => {
    const { app, container } = await harness();
    open = container;

    await request(app).get('/api/problems/does-not-exist').expect(404);
    await request(app)
      .get('/api/attempts/att_nope')
      .set('x-learner-id', LEARNER)
      .expect(404);
  });

  it('reports which reviewer is wired on the health endpoint', async () => {
    const { app, container } = await harness();
    open = container;

    const health = await request(app).get('/api/health').expect(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.storage).toBe('in-memory');
    expect(health.body.reviewer.simulated).toBe(true);
  });
});

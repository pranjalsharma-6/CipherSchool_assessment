import { describe, expect, it } from 'vitest';
import { Attempt, MAX_EVALUATION_RUNS } from '../src/domain/attempt/Attempt.js';
import { IllegalStateTransitionError, ValidationError } from '../src/domain/shared/errors.js';
import { AttemptId, LearnerId, ProblemId } from '../src/domain/shared/ids.js';
import { FakeClock, strongParkingLotSubmission } from './fixtures.js';
import type { Evaluation } from '../src/domain/evaluation/Evaluation.js';

const clock = new FakeClock();

function newAttempt(): Attempt {
  return Attempt.start({
    id: AttemptId('att_test'),
    problemId: ProblemId('prob_parking_lot'),
    learnerId: LearnerId('learner-1'),
    attemptNumber: 1,
    now: clock.now(),
  });
}

const evaluation = (score: number, degraded = false): Evaluation => ({
  overallScore: score,
  dimensionScores: [],
  feedback: [],
  requirementCoverage: [],
  summary: 'ok',
  degraded,
  degradedReason: degraded ? 'model unavailable' : null,
  evaluators: [],
  generatedAt: clock.now(),
});

describe('Attempt lifecycle', () => {
  it('walks the happy path from draft to evaluated', () => {
    const attempt = newAttempt();
    expect(attempt.status).toBe('draft');

    attempt.submit(strongParkingLotSubmission(), clock.now());
    expect(attempt.status).toBe('queued');
    expect(attempt.submittedAt).not.toBeNull();

    attempt.markEvaluating(clock.now());
    expect(attempt.status).toBe('evaluating');
    expect(attempt.evaluationRuns).toBe(1);

    attempt.completeEvaluation(evaluation(72), clock.now());
    expect(attempt.status).toBe('evaluated');
    expect(attempt.evaluation?.overallScore).toBe(72);
    expect(attempt.events.map((e) => e.type)).toEqual([
      'created',
      'submitted',
      'evaluation_started',
      'evaluation_completed',
    ]);
  });

  it('refuses to resubmit an attempt that is already evaluated', () => {
    const attempt = newAttempt();
    attempt.submit(strongParkingLotSubmission(), clock.now());
    attempt.markEvaluating(clock.now());
    attempt.completeEvaluation(evaluation(72), clock.now());

    expect(() => attempt.submit(strongParkingLotSubmission(), clock.now())).toThrow(
      IllegalStateTransitionError,
    );
  });

  it('refuses to edit the draft once it has been submitted', () => {
    const attempt = newAttempt();
    attempt.submit(strongParkingLotSubmission(), clock.now());

    expect(() => attempt.saveDraft(strongParkingLotSubmission(), clock.now())).toThrow(
      ValidationError,
    );
  });

  it('rejects a submission too thin to be worth evaluating', () => {
    const attempt = newAttempt();

    expect(() =>
      attempt.submit(
        {
          format: 'structured',
          entities: [{ name: 'Lot', kind: 'class', responsibility: 'everything', members: [] }],
          relationships: [],
          operations: [],
          tradeoffs: '',
          assumptions: '',
        },
        clock.now(),
      ),
    ).toThrow(ValidationError);

    // The guard must not leave the attempt in a half-submitted state.
    expect(attempt.status).toBe('draft');
  });

  it('re-queues a retryable failure and gives up after the run limit', () => {
    const attempt = newAttempt();
    attempt.submit(strongParkingLotSubmission(), clock.now());

    for (let run = 1; run < MAX_EVALUATION_RUNS; run += 1) {
      attempt.markEvaluating(clock.now());
      attempt.failEvaluation('model overloaded', true, clock.now());
      expect(attempt.status).toBe('queued');
    }

    attempt.markEvaluating(clock.now());
    expect(attempt.evaluationRuns).toBe(MAX_EVALUATION_RUNS);
    attempt.failEvaluation('model overloaded', true, clock.now());
    expect(attempt.status).toBe('failed');
    expect(attempt.failureReason).toBe('model overloaded');
  });

  it('fails immediately on a non-retryable error, keeping the submission', () => {
    const attempt = newAttempt();
    attempt.submit(strongParkingLotSubmission(), clock.now());
    attempt.markEvaluating(clock.now());
    attempt.failEvaluation('problem definition is corrupt', false, clock.now());

    expect(attempt.status).toBe('failed');
    expect(attempt.submission).not.toBeNull();
  });

  it('lets a learner re-run a failed evaluation with a fresh run budget', () => {
    const attempt = newAttempt();
    attempt.submit(strongParkingLotSubmission(), clock.now());
    attempt.markEvaluating(clock.now());
    attempt.failEvaluation('boom', false, clock.now());

    attempt.retryEvaluation(clock.now());
    expect(attempt.status).toBe('queued');
    expect(attempt.evaluationRuns).toBe(0);
  });
});

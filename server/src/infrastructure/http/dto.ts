import type { Attempt } from '../../domain/attempt/Attempt.js';
import { isPending } from '../../domain/attempt/AttemptStatus.js';
import type { Problem } from '../../domain/problem/Problem.js';

/**
 * Domain → wire mapping.
 *
 * Kept explicit rather than serialising aggregates directly: the API shape is a
 * contract with the client, and it should not change silently because a private
 * field was renamed.
 */
export function problemSummaryDto(problem: Problem) {
  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    difficulty: problem.difficulty,
    summary: problem.summary,
    tags: problem.tags,
    estimatedMinutes: problem.estimatedMinutes,
    requirementCount: problem.statedRequirements().length,
  };
}

export function problemDto(problem: Problem) {
  return {
    ...problemSummaryDto(problem),
    statement: problem.statement,
    constraints: problem.constraints,
    // Only the learner-facing text: signals, concepts and pitfalls are the
    // grading key and stay on the server.
    requirements: problem.statedRequirements().map((r) => ({ id: r.id, text: r.text })),
    discussionPrompts: problem.discussionPrompts,
    rubric: problem.rubric.dimensions.map((d) => ({
      id: d.id,
      label: d.label,
      weight: Number(d.weight.toFixed(3)),
    })),
  };
}

export function attemptDto(attempt: Attempt) {
  return {
    id: attempt.id,
    problemId: attempt.problemId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    pending: isPending(attempt.status),
    submission: attempt.submission,
    evaluation: attempt.evaluation,
    failureReason: attempt.failureReason,
    events: attempt.events,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
    submittedAt: attempt.submittedAt,
    evaluatedAt: attempt.evaluatedAt,
  };
}

/** The history list does not need the full submission or feedback body. */
export function attemptSummaryDto(attempt: Attempt) {
  return {
    id: attempt.id,
    problemId: attempt.problemId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    pending: isPending(attempt.status),
    format: attempt.submission?.format ?? null,
    score: attempt.evaluation?.overallScore ?? null,
    degraded: attempt.evaluation?.degraded ?? false,
    dimensionScores:
      attempt.evaluation?.dimensionScores.map((d) => ({
        dimension: d.dimension,
        label: d.label,
        score: d.score,
      })) ?? [],
    createdAt: attempt.createdAt,
    submittedAt: attempt.submittedAt,
    evaluatedAt: attempt.evaluatedAt,
  };
}

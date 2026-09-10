import type { Attempt } from '../domain/attempt/Attempt.js';
import type { Problem } from '../domain/problem/Problem.js';
import type { AttemptId, LearnerId, ProblemId } from '../domain/shared/ids.js';

/**
 * The ports the application layer depends on.
 *
 * Interfaces live next to the code that *uses* them, not next to the adapters
 * that implement them, so the dependency arrow points inward: Mongo knows about
 * the domain, the domain knows nothing about Mongo. That is what lets the whole
 * test suite run against in-memory adapters in milliseconds and lets a fresh
 * clone start with no database at all.
 */
export interface ProblemRepository {
  findAll(): Promise<readonly Problem[]>;
  findById(id: ProblemId): Promise<Problem | null>;
  findBySlug(slug: string): Promise<Problem | null>;
}

export interface AttemptRepository {
  save(attempt: Attempt): Promise<void>;
  findById(id: AttemptId): Promise<Attempt | null>;
  /** Newest first. */
  findByLearner(learnerId: LearnerId): Promise<readonly Attempt[]>;
  findByLearnerAndProblem(
    learnerId: LearnerId,
    problemId: ProblemId,
  ): Promise<readonly Attempt[]>;
  countByLearnerAndProblem(learnerId: LearnerId, problemId: ProblemId): Promise<number>;
}

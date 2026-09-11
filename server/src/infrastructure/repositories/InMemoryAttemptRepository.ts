import { Attempt } from '../../domain/attempt/Attempt.js';
import type { AttemptId, LearnerId, ProblemId } from '../../domain/shared/ids.js';
import type { AttemptRepository } from '../../application/ports.js';

/**
 * The default attempt store: everything a demo or a test needs, nothing to
 * install. Aggregates are copied on the way in and out so a caller holding a
 * reference cannot mutate stored state: the same isolation a real database
 * gives for free, which keeps behaviour identical across both adapters.
 */
export class InMemoryAttemptRepository implements AttemptRepository {
  private readonly byId = new Map<string, Attempt>();

  async save(attempt: Attempt): Promise<void> {
    this.byId.set(attempt.id, new Attempt(structuredCloneProps(attempt)));
  }

  async findById(id: AttemptId): Promise<Attempt | null> {
    const found = this.byId.get(id);
    return found ? new Attempt(structuredCloneProps(found)) : null;
  }

  async findByLearner(learnerId: LearnerId): Promise<readonly Attempt[]> {
    return this.sorted().filter((a) => a.learnerId === learnerId);
  }

  async findByLearnerAndProblem(
    learnerId: LearnerId,
    problemId: ProblemId,
  ): Promise<readonly Attempt[]> {
    return this.sorted().filter((a) => a.learnerId === learnerId && a.problemId === problemId);
  }

  async countByLearnerAndProblem(learnerId: LearnerId, problemId: ProblemId): Promise<number> {
    return (await this.findByLearnerAndProblem(learnerId, problemId)).length;
  }

  private sorted(): Attempt[] {
    return [...this.byId.values()]
      .map((a) => new Attempt(structuredCloneProps(a)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

function structuredCloneProps(attempt: Attempt) {
  const props = attempt.toProps();
  return {
    ...props,
    events: props.events.map((e) => ({ ...e })),
  };
}

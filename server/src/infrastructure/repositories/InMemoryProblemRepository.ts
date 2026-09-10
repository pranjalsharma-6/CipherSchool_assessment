import type { Problem } from '../../domain/problem/Problem.js';
import type { ProblemId } from '../../domain/shared/ids.js';
import type { ProblemRepository } from '../../application/ports.js';

/** Problems are authored content and never change at runtime, so this is enough. */
export class InMemoryProblemRepository implements ProblemRepository {
  private readonly byId = new Map<string, Problem>();

  constructor(problems: readonly Problem[] = []) {
    for (const problem of problems) this.byId.set(problem.id, problem);
  }

  async findAll(): Promise<readonly Problem[]> {
    return [...this.byId.values()];
  }

  async findById(id: ProblemId): Promise<Problem | null> {
    return this.byId.get(id) ?? null;
  }

  async findBySlug(slug: string): Promise<Problem | null> {
    return [...this.byId.values()].find((p) => p.slug === slug) ?? null;
  }
}

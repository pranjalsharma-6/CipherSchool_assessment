import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AttemptSummary, ProblemSummary } from '../api/types';
import { Banner, DifficultyBadge, Empty, scoreClass } from '../components/primitives';

export function ProblemsPage() {
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listProblems(), api.history()])
      .then(([p, a]) => {
        setProblems(p);
        setAttempts(a);
      })
      .catch((e) => setError(e.message));
  }, []);

  /** Best score so far per problem, so the catalogue shows progress at a glance. */
  const bestByProblem = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.score === null) continue;
    bestByProblem.set(
      attempt.problemId,
      Math.max(bestByProblem.get(attempt.problemId) ?? 0, attempt.score),
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">Practice</div>
        <h1>Pick a problem</h1>
        <p>
          Design it, submit it, and get feedback that points at your actual classes. Every
          attempt is kept, so you can see what changed when you try again.
        </p>
      </header>

      {error && <Banner kind="error">{error}</Banner>}

      {!problems && (
        <div className="grid grid-problems">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton" key={i} style={{ height: 168 }} />
          ))}
        </div>
      )}

      {problems && problems.length === 0 && <Empty>No problems are seeded.</Empty>}

      {problems && problems.length > 0 && (
        <div className="grid grid-problems">
          {problems.map((problem) => {
            const best = bestByProblem.get(problem.id);
            const tried = attempts.filter((a) => a.problemId === problem.id).length;

            return (
              <Link className="problem-card" to={`/problems/${problem.slug}`} key={problem.id}>
                <div className="card-head" style={{ marginBottom: 0 }}>
                  <h3>{problem.title}</h3>
                  <DifficultyBadge difficulty={problem.difficulty} />
                </div>
                <p className="summary">{problem.summary}</p>
                <div className="chips">
                  {problem.tags.map((tag) => (
                    <span className="chip" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <footer>
                  <span>~{problem.estimatedMinutes} min</span>
                  <span>·</span>
                  <span>{problem.requirementCount} requirements</span>
                  <span style={{ marginLeft: 'auto' }}>
                    {best !== undefined ? (
                      <span className={scoreClass(best)}>
                        best {best} · {tried} attempt{tried === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="faint">not attempted</span>
                    )}
                  </span>
                </footer>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

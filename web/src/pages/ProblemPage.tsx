import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AttemptSummary, Problem } from '../api/types';
import {
  Badge,
  Banner,
  Card,
  DifficultyBadge,
  relativeTime,
  scoreClass,
} from '../components/primitives';

export function ProblemPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api
      .getProblem(slug)
      .then(async (p) => {
        setProblem(p);
        setAttempts(await api.history(p.id));
      })
      .catch((e) => setError(e.message));
  }, [slug]);

  async function start(): Promise<void> {
    if (!problem) return;
    setStarting(true);
    try {
      const attempt = await api.startAttempt(problem.slug);
      navigate(`/attempts/${attempt.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  if (error) {
    return (
      <div className="page page-narrow">
        <Banner kind="error">{error}</Banner>
        <Link to="/">← Back to problems</Link>
      </div>
    );
  }

  if (!problem) {
    return (
      <div className="page page-narrow">
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  const best = attempts.reduce<number | null>(
    (max, a) => (a.score === null ? max : Math.max(max ?? 0, a.score)),
    null,
  );

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">
          <Link to="/">Problems</Link> / {problem.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1>{problem.title}</h1>
          <DifficultyBadge difficulty={problem.difficulty} />
          <Badge>~{problem.estimatedMinutes} min</Badge>
          {best !== null && <Badge kind="accent">best {best}/100</Badge>}
        </div>
        <p style={{ marginTop: 8 }}>{problem.summary}</p>
      </header>

      <div className="split">
        <div>
          <Card title="The problem">
            <div className="statement">{problem.statement}</div>
          </Card>

          <Card title="Requirements">
            <ol className="list-plain">
              {problem.requirements.map((requirement) => (
                <li key={requirement.id}>{requirement.text}</li>
              ))}
            </ol>
          </Card>

          <Card title="Constraints">
            <ul className="list-plain">
              {problem.constraints.map((constraint) => (
                <li key={constraint}>{constraint}</li>
              ))}
            </ul>
          </Card>

          <Card title="Questions your design should be able to answer">
            <ul className="list-plain">
              {problem.discussionPrompts.map((prompt) => (
                <li key={prompt}>{prompt}</li>
              ))}
            </ul>
            <p className="small faint" style={{ marginTop: 10 }}>
              These are not graded directly — they are the questions an interviewer would ask
              next. A design that answers them tends to score well on its own.
            </p>
          </Card>
        </div>

        <aside className="sticky">
          <Card>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={start}
              disabled={starting}
            >
              {starting ? 'Starting…' : attempts.length > 0 ? 'Try again' : 'Start attempt'}
            </button>
            <p className="small faint" style={{ marginTop: 10 }}>
              You will be asked to name your classes, their responsibilities and how they
              relate — or you can submit code or a Mermaid class diagram instead.
            </p>
          </Card>

          <Card title="How this is scored">
            <div className="dimensions">
              {problem.rubric.map((dimension) => (
                <div className="dimension-row" key={dimension.id}>
                  <span className="dimension-label">{dimension.label}</span>
                  <span className="dimension-value">{Math.round(dimension.weight * 100)}%</span>
                  <div className="meter">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${dimension.weight * 100 * 2.6}%`,
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {attempts.length > 0 && (
            <Card title={`Your attempts (${attempts.length})`}>
              <div className="row-editor">
                {attempts.slice(0, 5).map((attempt) => (
                  <Link className="attempt-row" to={`/attempts/${attempt.id}`} key={attempt.id}>
                    <span className="attempt-num">#{attempt.attemptNumber}</span>
                    <span className="small">
                      {attempt.status === 'evaluated' ? (
                        <span className={scoreClass(attempt.score ?? 0)}>
                          {attempt.score}/100
                        </span>
                      ) : (
                        <span className="muted">{attempt.status}</span>
                      )}
                      <span className="faint"> · {relativeTime(attempt.createdAt)}</span>
                    </span>
                  </Link>
                ))}
              </div>
              {attempts.length > 5 && (
                <p className="small" style={{ marginTop: 10 }}>
                  <Link to="/history">See all attempts →</Link>
                </p>
              )}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

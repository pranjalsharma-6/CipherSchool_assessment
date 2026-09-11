import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AttemptSummary, ProblemSummary } from '../api/types';
import {
  Badge,
  Banner,
  Card,
  Empty,
  relativeTime,
  scoreClass,
  scoreColor,
} from '../components/primitives';

/**
 * The progress view.
 *
 * The reason the platform stores every attempt rather than only the best one:
 * the useful question is not "what did I score" but "did the thing I was told
 * to fix last time actually improve". Grouping by problem and charting the
 * score across attempts is what makes that visible.
 */
export function HistoryPage() {
  const [attempts, setAttempts] = useState<AttemptSummary[] | null>(null);
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.history(), api.listProblems()])
      .then(([a, p]) => {
        setAttempts(a);
        setProblems(p);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="page page-narrow">
        <Banner kind="error">{error}</Banner>
      </div>
    );
  }

  if (!attempts) {
    return (
      <div className="page page-narrow">
        <div className="skeleton" style={{ height: 240 }} />
      </div>
    );
  }

  const byProblem = new Map<string, AttemptSummary[]>();
  for (const attempt of attempts) {
    byProblem.set(attempt.problemId, [...(byProblem.get(attempt.problemId) ?? []), attempt]);
  }

  const evaluated = attempts.filter((a) => a.score !== null);
  const average =
    evaluated.length > 0
      ? Math.round(evaluated.reduce((sum, a) => sum + (a.score ?? 0), 0) / evaluated.length)
      : null;

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div className="eyebrow">Progress</div>
        <h1>Your attempts</h1>
        <p>
          {attempts.length} attempt{attempts.length === 1 ? '' : 's'} across{' '}
          {byProblem.size} problem{byProblem.size === 1 ? '' : 's'}
          {average !== null && (
            <>
              {' · '}
              average score <span className={scoreClass(average)}>{average}</span>
            </>
          )}
          .
        </p>
      </header>

      {attempts.length === 0 && (
        <Empty>
          Nothing here yet. <Link to="/">Pick a problem</Link> to start your first attempt.
        </Empty>
      )}

      {[...byProblem.entries()].map(([problemId, list]) => {
        const problem = problems.find((p) => p.id === problemId);
        const ordered = [...list].sort((a, b) => a.attemptNumber - b.attemptNumber);
        const scores = ordered.map((a) => a.score).filter((s): s is number => s !== null);
        // Exactly one attempt wears the badge. When several tie on the top
        // score, the earliest one earned it: later ties did not improve on it.
        const bestId = ordered.find((a) => a.score !== null && a.score === Math.max(...scores))?.id;

        return (
          <Card
            key={problemId}
            title={
              <div>
                <h2>{problem?.title ?? problemId}</h2>
                <p className="small faint" style={{ margin: '3px 0 0' }}>
                  {list.length} attempt{list.length === 1 ? '' : 's'}
                  {scores.length > 1 && (
                    <>
                      {' · '}
                      {scores[scores.length - 1]! > scores[0]!
                        ? `improved ${scores[scores.length - 1]! - scores[0]!} points`
                        : scores[scores.length - 1]! === scores[0]!
                          ? 'holding steady'
                          : `down ${scores[0]! - scores[scores.length - 1]!} points`}
                    </>
                  )}
                </p>
              </div>
            }
            actions={scores.length > 1 ? <Sparkline scores={scores} /> : undefined}
          >
            <div className="row-editor">
              {[...ordered].reverse().map((attempt) => (
                <Link className="attempt-row" to={`/attempts/${attempt.id}`} key={attempt.id}>
                  <span className="attempt-num">#{attempt.attemptNumber}</span>
                  <span>
                    <span className="small">
                      {attempt.status === 'evaluated' ? (
                        <>
                          <strong className={scoreClass(attempt.score ?? 0)}>
                            {attempt.score}/100
                          </strong>
                          {attempt.dimensionScores.length > 0 && (
                            <span className="faint">
                              {' '}
                              · weakest: {weakest(attempt)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="muted">{attempt.status}</span>
                      )}
                    </span>
                    <div className="timeline-time">
                      {relativeTime(attempt.createdAt)}
                      {attempt.format ? ` · ${attempt.format}` : ''}
                    </div>
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    {attempt.degraded && <Badge kind="warn">partial</Badge>}
                    {scores.length > 1 && attempt.id === bestId && (
                      <Badge kind="accent">best</Badge>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** A tiny score-over-attempts chart. Enough to read a trend, no library needed. */
function Sparkline({ scores }: { scores: number[] }) {
  const width = 108;
  const height = 34;
  const padding = 3;
  const max = 100;

  const points = scores.map((score, index) => {
    const x =
      scores.length === 1
        ? width / 2
        : padding + (index / (scores.length - 1)) * (width - padding * 2);
    const y = height - padding - (score / max) * (height - padding * 2);
    return { x, y, score };
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const last = points[points.length - 1]!;

  return (
    <svg className="sparkline" width={width} height={height} aria-label="score over attempts">
      <path d={path} fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2" fill={scoreColor(p.score)} />
      ))}
      <circle cx={last.x} cy={last.y} r="3.5" fill={scoreColor(last.score)} />
    </svg>
  );
}

function weakest(attempt: AttemptSummary): string {
  const sorted = [...attempt.dimensionScores].sort((a, b) => a.score - b.score);
  return sorted[0] ? `${sorted[0].label} ${sorted[0].score}` : ', ';
}

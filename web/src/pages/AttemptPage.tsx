import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, waitForEvaluation } from '../api/client';
import type { Attempt, AttemptSummary, Problem, Submission, SubmissionFormat } from '../api/types';
import { DesignEditor } from '../components/DesignEditor';
import { FeedbackReport } from '../components/FeedbackReport';
import { Badge, Banner, Card, Spinner, relativeTime } from '../components/primitives';

const EMPTY_STRUCTURED: Extract<Submission, { format: 'structured' }> = {
  format: 'structured',
  entities: [
    { name: '', kind: 'class', responsibility: '', members: [] },
    { name: '', kind: 'class', responsibility: '', members: [] },
  ],
  relationships: [{ from: '', to: '', kind: 'association', cardinality: '' }],
  operations: [],
  tradeoffs: '',
  assumptions: '',
};

const DIAGRAM_TEMPLATE = `classDiagram
  class ParkingLot {
    +park(Vehicle) ParkingTicket
    +unpark(ParkingTicket) Money
  }
  class PricingStrategy {
    <<interface>>
    +priceFor(ticket) Money
  }
  ParkingLot "1" *-- "1..*" ParkingFloor
  ParkingLot --> "1" PricingStrategy
`;

/**
 * The practice workspace.
 *
 * One page holds the whole loop: the brief on the left, the design on the
 * right, and the review replacing the editor once it is in. Keeping it on one
 * route means "try again" does not lose the learner's place, and the feedback
 * sits next to the requirements it refers to.
 */
export function AttemptPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [previousScore, setPreviousScore] = useState<number | null>(null);
  const [submission, setSubmission] = useState<Submission>(EMPTY_STRUCTURED);
  const [format, setFormat] = useState<SubmissionFormat>('structured');
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const pollAbort = useRef<AbortController | null>(null);

  // --- Load ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const loaded = await api.getAttempt(id);
      if (cancelled) return;

      setAttempt(loaded);
      if (loaded.submission) {
        setSubmission(loaded.submission);
        setFormat(loaded.submission.format);
      }

      const problems = await api.listProblems();
      const match = problems.find((p) => p.id === loaded.problemId);
      if (match && !cancelled) setProblem(await api.getProblem(match.slug));

      const history = await api.history(loaded.problemId);
      if (cancelled) return;
      setPreviousScore(previousScoreOf(history, loaded));

      // Resume polling if the page was reloaded while evaluation was running.
      if (loaded.pending) startPolling(loaded.id);
    })().catch((e) => setError({ message: (e as Error).message, details: [] }));

    return () => {
      cancelled = true;
      pollAbort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const startPolling = useCallback((attemptId: string) => {
    pollAbort.current?.abort();
    const controller = new AbortController();
    pollAbort.current = controller;

    waitForEvaluation(attemptId, setAttempt, controller.signal).catch((e) => {
      if ((e as Error).name !== 'AbortError') {
        setError({ message: (e as Error).message, details: [] });
      }
    });
  }, []);

  // --- Autosave -----------------------------------------------------------
  const editable = attempt?.status === 'draft';

  useEffect(() => {
    if (!editable || !attempt) return;
    // Debounced: the design form fires on every keystroke.
    const timer = setTimeout(() => {
      api
        .saveDraft(attempt.id, submission)
        .then(() => setSavedAt(new Date().toISOString()))
        .catch(() => {
          /* A failed autosave is not worth interrupting the learner for. */
        });
    }, 1200);
    return () => clearTimeout(timer);
  }, [submission, editable, attempt]);

  // --- Actions ------------------------------------------------------------
  async function submit(): Promise<void> {
    if (!attempt) return;
    setBusy(true);
    setError(null);
    try {
      const submitted = await api.submit(attempt.id, submission);
      setAttempt(submitted);
      startPolling(submitted.id);
    } catch (e) {
      if (e instanceof ApiError) setError({ message: e.message, details: e.details });
      else setError({ message: (e as Error).message, details: [] });
    } finally {
      setBusy(false);
    }
  }

  async function reevaluate(): Promise<void> {
    if (!attempt) return;
    setBusy(true);
    try {
      const retried = await api.reevaluate(attempt.id);
      setAttempt(retried);
      startPolling(retried.id);
    } catch (e) {
      setError({ message: (e as Error).message, details: [] });
    } finally {
      setBusy(false);
    }
  }

  async function tryAgain(): Promise<void> {
    if (!problem) return;
    const next = await api.startAttempt(problem.slug);
    navigate(`/attempts/${next.id}`);
  }

  function changeFormat(next: SubmissionFormat): void {
    setFormat(next);
    // Each format keeps its own draft shape; trade-off notes carry across
    // because they are about the design, not the way it was written down.
    const tradeoffs = 'tradeoffs' in submission ? submission.tradeoffs : '';
    if (next === 'structured') {
      setSubmission({ ...EMPTY_STRUCTURED, tradeoffs });
    } else if (next === 'code') {
      setSubmission({ format: 'code', language: 'typescript', source: '', tradeoffs });
    } else {
      setSubmission({ format: 'diagram', source: DIAGRAM_TEMPLATE, tradeoffs });
    }
  }

  const canSubmit = useMemo(() => editable && !busy && isWorthSubmitting(submission), [
    editable,
    busy,
    submission,
  ]);

  if (!attempt || !problem) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 380 }} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">
          <Link to="/">Problems</Link> / <Link to={`/problems/${problem.slug}`}>{problem.title}</Link>{' '}
          / Attempt #{attempt.attemptNumber}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1>{problem.title}</h1>
          <StatusBadge attempt={attempt} />
          {editable && savedAt && (
            <span className="small faint">draft saved {relativeTime(savedAt)}</span>
          )}
        </div>
      </header>

      {error && (
        <Banner kind="error">
          <strong>{error.message}</strong>
          {error.details.length > 0 && (
            <ul className="list-plain" style={{ marginTop: 6 }}>
              {error.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </Banner>
      )}

      {attempt.status === 'failed' && (
        <Banner kind="error">
          <strong>Evaluation failed.</strong> {attempt.failureReason}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={reevaluate} disabled={busy}>
              Re-run evaluation
            </button>
          </div>
          <p className="small" style={{ marginTop: 6, marginBottom: 0 }}>
            Your design is saved: nothing you wrote was lost.
          </p>
        </Banner>
      )}

      {attempt.pending && (
        <Banner kind="info">
          <span className="pulse">
            <Spinner /> {attempt.status === 'queued' ? 'Queued for review...' : 'Reviewing your design...'}
          </span>
          <p className="small" style={{ margin: '4px 0 0' }}>
            The deterministic checks are instant; the reviewer takes a few seconds. You can leave
            this page: the result is kept.
          </p>
        </Banner>
      )}

      <div className="split-wide">
        <aside className="sticky">
          <Card title="The brief">
            <div className="statement" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {problem.statement}
            </div>
          </Card>

          <Card title="Requirements">
            <ol className="list-plain">
              {problem.requirements.map((requirement) => (
                <li key={requirement.id}>{requirement.text}</li>
              ))}
            </ol>
          </Card>

          {attempt.events.length > 0 && (
            <Card title="Timeline">
              <div className="timeline">
                {attempt.events.map((event, index) => (
                  <div className="timeline-item" key={index}>
                    <div
                      className={`timeline-dot ${
                        event.type === 'evaluation_failed'
                          ? 'timeline-dot-bad'
                          : event.type === 'evaluation_completed'
                            ? 'timeline-dot-active'
                            : ''
                      }`}
                    />
                    <div>
                      <div className="timeline-label">{eventLabel(event.type)}</div>
                      <div className="timeline-time">
                        {relativeTime(event.at)}
                        {event.detail ? ` · ${event.detail}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </aside>

        <div>
          {attempt.status === 'evaluated' && attempt.evaluation ? (
            <>
              <FeedbackReport attempt={attempt} previousScore={previousScore} />
              <div className="btn-row" style={{ marginTop: 16 }}>
                <button type="button" className="btn btn-primary" onClick={tryAgain}>
                  Try again with a new attempt
                </button>
                <Link className="btn" to={`/problems/${problem.slug}`}>
                  Back to the problem
                </Link>
                <Link className="btn btn-ghost" to="/history">
                  See your progress
                </Link>
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 14,
                  flexWrap: 'wrap',
                }}
              >
                <div className="tabs">
                  {(['structured', 'code', 'diagram'] as const).map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={`tab ${format === option ? 'active' : ''}`}
                      disabled={!editable}
                      onClick={() => changeFormat(option)}
                    >
                      {option === 'structured'
                        ? 'Structured design'
                        : option === 'code'
                          ? 'Code'
                          : 'Class diagram'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submit}
                  disabled={!canSubmit}
                >
                  {busy ? 'Submitting...' : 'Submit for review'}
                </button>
              </div>

              {format === 'structured' && submission.format === 'structured' && (
                <DesignEditor
                  value={submission}
                  onChange={setSubmission}
                  disabled={!editable}
                />
              )}

              {format === 'code' && submission.format === 'code' && (
                <Card title="Code">
                  <div className="field" style={{ maxWidth: 200 }}>
                    <label htmlFor="language">Language</label>
                    <select
                      id="language"
                      value={submission.language}
                      disabled={!editable}
                      onChange={(e) =>
                        setSubmission({
                          ...submission,
                          language: e.target.value as 'typescript' | 'java' | 'python',
                        })
                      }
                    >
                      <option value="typescript">TypeScript</option>
                      <option value="java">Java</option>
                      <option value="python">Python</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="source">
                      Classes and interfaces: signatures are enough, bodies are not graded
                    </label>
                    <textarea
                      id="source"
                      className="mono"
                      rows={22}
                      value={submission.source}
                      disabled={!editable}
                      placeholder={'interface PricingStrategy {\n  priceFor(ticket: Ticket): Money;\n}\n\nclass ParkingLot {\n  private floors: ParkingFloor[];\n}'}
                      onChange={(e) => setSubmission({ ...submission, source: e.target.value })}
                    />
                  </div>
                  <TradeoffField
                    value={submission.tradeoffs}
                    disabled={!editable}
                    onChange={(tradeoffs) => setSubmission({ ...submission, tradeoffs })}
                  />
                </Card>
              )}

              {format === 'diagram' && submission.format === 'diagram' && (
                <Card title="Mermaid class diagram">
                  <div className="field">
                    <label htmlFor="diagram">
                      Arrow direction and cardinality are both read: <span className="mono">*--</span>{' '}
                      composition, <span className="mono">o--</span> aggregation,{' '}
                      <span className="mono">{'<|--'}</span> inheritance,{' '}
                      <span className="mono">{'..|>'}</span> implements
                    </label>
                    <textarea
                      id="diagram"
                      className="mono"
                      rows={20}
                      value={submission.source}
                      disabled={!editable}
                      onChange={(e) => setSubmission({ ...submission, source: e.target.value })}
                    />
                  </div>
                  <TradeoffField
                    value={submission.tradeoffs}
                    disabled={!editable}
                    onChange={(tradeoffs) => setSubmission({ ...submission, tradeoffs })}
                  />
                </Card>
              )}

              {!editable && !attempt.pending && attempt.status !== 'failed' && (
                <Banner kind="info">
                  This attempt has been submitted and can no longer be edited. Start a new attempt
                  to iterate on the design.
                </Banner>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TradeoffField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="tradeoffs-alt">
        Trade-offs: name one alternative you rejected and what it would have cost
      </label>
      <textarea
        id="tradeoffs-alt"
        rows={6}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="field-hint">
        Graded on its own axis, and the only part of the rubric the rules cannot judge for you.
      </p>
    </div>
  );
}

function StatusBadge({ attempt }: { attempt: Attempt }) {
  const kind =
    attempt.status === 'evaluated'
      ? 'easy'
      : attempt.status === 'failed'
        ? 'hard'
        : attempt.pending
          ? 'accent'
          : 'muted';
  return <Badge kind={kind}>{attempt.status}</Badge>;
}

/** The score of the most recent evaluated attempt before this one. */
function previousScoreOf(history: AttemptSummary[], current: Attempt): number | null {
  const earlier = history
    .filter((a) => a.id !== current.id && a.score !== null)
    .filter((a) => a.attemptNumber < current.attemptNumber)
    .sort((a, b) => b.attemptNumber - a.attemptNumber);
  return earlier[0]?.score ?? null;
}

/** Mirrors the server's submittability guard so the button disables early. */
function isWorthSubmitting(submission: Submission): boolean {
  if (submission.format === 'structured') {
    const named = submission.entities.filter(
      (e) => e.name.trim() && e.responsibility.trim().length >= 10,
    );
    const related = submission.relationships.filter((r) => r.from.trim() && r.to.trim());
    return named.length >= 2 && related.length >= 1;
  }
  if (submission.format === 'code') return submission.source.trim().length >= 120;
  return /classDiagram/i.test(submission.source) && submission.source.trim().length >= 60;
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Attempt started',
  draft_saved: 'Draft saved',
  submitted: 'Submitted for review',
  evaluation_started: 'Evaluation started',
  evaluation_completed: 'Review ready',
  evaluation_retried: 'Retrying evaluation',
  evaluation_failed: 'Evaluation failed',
};

const eventLabel = (type: string): string => EVENT_LABELS[type] ?? type;

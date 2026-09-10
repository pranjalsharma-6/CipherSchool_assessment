import { useState } from 'react';
import type { Attempt, Evaluation, FeedbackItem } from '../api/types';
import { Badge, Banner, Card, ScoreRing, scoreColor, scoreClass } from './primitives';

const KIND_LABEL: Record<FeedbackItem['kind'], string> = {
  gap: 'Gap',
  pitfall: 'Pitfall',
  suggestion: 'Suggestion',
  question: 'Worth asking',
  strength: 'Strength',
};

const SOURCE_LABEL = {
  deterministic: 'rule',
  llm: 'reviewer',
} as const;

/**
 * The feedback screen.
 *
 * Two decisions carry most of the weight here. Every item is labelled with the
 * source that produced it, so the learner can tell a checkable fact from an
 * opinion. And requirement coverage shows the evidence that was matched, so a
 * verdict the learner disagrees with can be argued with rather than just
 * absorbed — which matters when there is more than one right answer.
 */
export function FeedbackReport({
  attempt,
  previousScore,
}: {
  attempt: Attempt;
  previousScore?: number | null;
}) {
  const evaluation = attempt.evaluation;
  if (!evaluation) return null;

  return (
    <div>
      {evaluation.degraded && (
        <Banner kind="warn">
          <strong>Partial review.</strong> The reviewer model was unavailable
          {evaluation.degradedReason ? ` (${evaluation.degradedReason})` : ''}, so this score
          comes from the deterministic checks only — the qualitative half is missing. Your
          submission is safe; re-run the evaluation to get the rest.
        </Banner>
      )}

      <Card>
        <div className="score-hero">
          <ScoreRing score={evaluation.overallScore} />
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">
              Attempt #{attempt.attemptNumber}
              {typeof previousScore === 'number' && (
                <>
                  {' · '}
                  <Delta from={previousScore} to={evaluation.overallScore} />
                </>
              )}
            </div>
            <p style={{ fontSize: 14, marginBottom: 10 }}>{evaluation.summary}</p>
            <Provenance evaluation={evaluation} />
          </div>
        </div>
      </Card>

      <Card title="Rubric breakdown">
        <div className="dimensions">
          {evaluation.dimensionScores.map((dimension) => (
            <div className="dimension-row" key={dimension.dimension}>
              <span className="dimension-label">{dimension.label}</span>
              <span className={`dimension-value ${scoreClass(dimension.score)}`}>
                {dimension.score}
                <span className="faint"> · {Math.round(dimension.weight * 100)}% weight</span>
              </span>
              <div className="meter">
                <div
                  className="meter-fill"
                  style={{
                    width: `${dimension.score}%`,
                    background: scoreColor(dimension.score),
                  }}
                />
              </div>
              <div className="dimension-meta">
                {dimension.deterministicScore !== null && (
                  <>rules {dimension.deterministicScore}</>
                )}
                {dimension.deterministicScore !== null && dimension.llmScore !== null && ' · '}
                {dimension.llmScore !== null && <>reviewer {dimension.llmScore}</>}
                {dimension.rationale && <> — {dimension.rationale}</>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Feedback">
        <div className="feedback-list">
          {evaluation.feedback.map((item) => (
            <article className={`feedback feedback-${item.kind}`} key={`${item.source}-${item.id}`}>
              <header className="feedback-head">
                <span className="feedback-title">{item.title}</span>
                <Badge kind={badgeKind(item.kind)}>{KIND_LABEL[item.kind]}</Badge>
                <span
                  className={`source-tag source-${item.source}`}
                  title={
                    item.source === 'deterministic'
                      ? 'Found by a reproducible rule — it can show you its evidence'
                      : 'A reviewer judgement — worth arguing with if you disagree'
                  }
                >
                  {SOURCE_LABEL[item.source]}
                </span>
              </header>
              <p className="feedback-detail">{item.detail}</p>
            </article>
          ))}
          {evaluation.feedback.length === 0 && (
            <p className="muted small">No feedback items were produced.</p>
          )}
        </div>
      </Card>

      {evaluation.requirementCoverage.length > 0 && (
        <RequirementCoverage evaluation={evaluation} />
      )}
    </div>
  );
}

function RequirementCoverage({ evaluation }: { evaluation: Evaluation }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const stated = evaluation.requirementCoverage.filter((r) => r.kind === 'stated');
  const implied = evaluation.requirementCoverage.filter((r) => r.kind === 'implied');
  const covered = stated.filter((r) => r.covered).length;

  return (
    <Card
      title={
        <div>
          <h2>Requirement coverage</h2>
          <p className="small faint" style={{ margin: '3px 0 0' }}>
            {covered} of {stated.length} stated requirements detected in your design.
          </p>
        </div>
      }
      actions={
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setShowEvidence((v) => !v)}
        >
          {showEvidence ? 'Hide evidence' : 'Show evidence'}
        </button>
      }
    >
      <div className="coverage-list">
        {stated.map((requirement) => (
          <div className="coverage-item" key={requirement.requirementId}>
            <span
              className={`coverage-mark ${requirement.covered ? 'coverage-yes' : 'coverage-no'}`}
              aria-hidden
            >
              {requirement.covered ? '✓' : '✕'}
            </span>
            <div>
              <div className={requirement.covered ? '' : 'coverage-text-missed'}>
                {requirement.text}
              </div>
              {showEvidence && requirement.covered && (
                <div className="coverage-evidence">
                  matched: {requirement.matchedSignals.join(', ')}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {implied.length > 0 && (
        <>
          <div className="divider" />
          <div className="eyebrow">Not in the brief — did you think of them?</div>
          <div className="coverage-list">
            {implied.map((requirement) => (
              <div className="coverage-item" key={requirement.requirementId}>
                <span
                  className={`coverage-mark ${requirement.covered ? 'coverage-yes' : 'faint'}`}
                  aria-hidden
                >
                  {requirement.covered ? '✓' : '○'}
                </span>
                <div className={requirement.covered ? '' : 'coverage-text-missed'}>
                  {requirement.text}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Provenance({ evaluation }: { evaluation: Evaluation }) {
  return (
    <div className="chips">
      {evaluation.evaluators.map((run) => (
        <span
          className="chip"
          key={run.name}
          title={run.error ?? `${run.name} ${run.version}`}
        >
          {run.status === 'ok' ? '●' : run.status === 'failed' ? '✕' : '○'} {run.name} ·{' '}
          {run.durationMs}ms
        </span>
      ))}
    </div>
  );
}

function Delta({ from, to }: { from: number; to: number }) {
  const change = to - from;
  if (change === 0) return <span className="faint">no change from last attempt</span>;
  return (
    <span className={change > 0 ? 'score-good' : 'score-bad'}>
      {change > 0 ? '▲' : '▼'} {Math.abs(change)} from last attempt
    </span>
  );
}

function badgeKind(kind: FeedbackItem['kind']): string {
  if (kind === 'strength') return 'easy';
  if (kind === 'gap' || kind === 'pitfall') return 'hard';
  if (kind === 'suggestion') return 'medium';
  return 'accent';
}

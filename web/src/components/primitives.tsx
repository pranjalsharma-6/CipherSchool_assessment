import type { ReactNode } from 'react';
import type { Difficulty } from '../api/types';

export function Badge({ kind, children }: { kind?: string; children: ReactNode }) {
  return <span className={`badge badge-${kind ?? 'muted'}`}>{children}</span>;
}

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <span className={`badge badge-${difficulty}`}>{difficulty}</span>;
}

export function Banner({
  kind,
  children,
}: {
  kind: 'warn' | 'error' | 'info';
  children: ReactNode;
}) {
  const icon = kind === 'error' ? '✕' : kind === 'warn' ? '!' : 'i';
  return (
    <div className={`banner banner-${kind}`}>
      <strong aria-hidden>{icon}</strong>
      <div>{children}</div>
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

/** Score → colour band. 70+ reads as solid, 45+ as needs work, below as weak. */
export function scoreClass(score: number): string {
  if (score >= 70) return 'score-good';
  if (score >= 45) return 'score-ok';
  return 'score-bad';
}

export function scoreColor(score: number): string {
  if (score >= 70) return 'var(--good)';
  if (score >= 45) return 'var(--ok)';
  return 'var(--bad)';
}

/** A circular score gauge; the arc length encodes the score. */
export function ScoreRing({ score, size = 104 }: { score: number; size?: number }) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--bg-inset)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={scoreColor(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{ transition: 'stroke-dasharray 0.7s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
        />
      </svg>
      <div className={`score-ring-value ${scoreClass(score)}`}>
        {score}
        <small>/100</small>
      </div>
    </div>
  );
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

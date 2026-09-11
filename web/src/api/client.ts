import type {
  Attempt,
  AttemptSummary,
  Health,
  Problem,
  ProblemSummary,
  Submission,
} from './types';

/**
 * The learner id.
 *
 * The MVP has no accounts. A per-browser id kept in localStorage is enough to
 * make history and progress real, and it is deliberately the only place the
 * frontend decides who the learner is: swapping in a real session token later
 * means changing this function and nothing else.
 */
function learnerId(): string {
  const KEY = 'lld-practice.learner-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `learner-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-learner-id': learnerId(),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (body as { error?: { code: string; message: string; details?: string[] } })?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? `Request failed with ${response.status}`,
      error?.details ?? [],
    );
  }
  return body as T;
}

export const api = {
  health: () => call<Health>('/health'),

  listProblems: () =>
    call<{ problems: ProblemSummary[] }>('/problems').then((r) => r.problems),

  getProblem: (idOrSlug: string) =>
    call<{ problem: Problem }>(`/problems/${idOrSlug}`).then((r) => r.problem),

  startAttempt: (problemId: string) =>
    call<{ attempt: Attempt }>('/attempts', {
      method: 'POST',
      body: JSON.stringify({ problemId }),
    }).then((r) => r.attempt),

  getAttempt: (id: string) =>
    call<{ attempt: Attempt }>(`/attempts/${id}`).then((r) => r.attempt),

  saveDraft: (id: string, submission: Submission) =>
    call<{ attempt: Attempt }>(`/attempts/${id}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ submission }),
    }).then((r) => r.attempt),

  submit: (id: string, submission: Submission) =>
    call<{ attempt: Attempt }>(`/attempts/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ submission }),
    }).then((r) => r.attempt),

  reevaluate: (id: string) =>
    call<{ attempt: Attempt }>(`/attempts/${id}/reevaluate`, { method: 'POST' }).then(
      (r) => r.attempt,
    ),

  history: (problemId?: string) =>
    call<{ attempts: AttemptSummary[] }>(
      problemId ? `/attempts?problemId=${encodeURIComponent(problemId)}` : '/attempts',
    ).then((r) => r.attempts),
};

/**
 * Polls an attempt until evaluation finishes.
 *
 * Polling rather than websockets: evaluation takes seconds, there is exactly
 * one interested client, and a poll loop cannot get out of sync with the
 * server's view of the attempt. The interval backs off so a slow model does not
 * mean a hundred requests.
 */
export async function waitForEvaluation(
  id: string,
  onUpdate: (attempt: Attempt) => void,
  signal?: AbortSignal,
): Promise<Attempt> {
  let delay = 600;
  for (;;) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const attempt = await api.getAttempt(id);
    onUpdate(attempt);
    if (!attempt.pending) return attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.4, 3000);
  }
}

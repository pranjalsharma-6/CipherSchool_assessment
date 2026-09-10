import { randomUUID } from 'node:crypto';

/**
 * Branded id types.
 *
 * `AttemptId` and `ProblemId` are both strings at runtime, but the brand stops
 * the compiler from letting one be passed where the other is expected — a
 * cheap way to remove a whole class of argument-order bugs in the services.
 */
declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type AttemptId = Branded<string, 'AttemptId'>;
export type ProblemId = Branded<string, 'ProblemId'>;
export type LearnerId = Branded<string, 'LearnerId'>;

export const AttemptId = (value: string): AttemptId => value as AttemptId;
export const ProblemId = (value: string): ProblemId => value as ProblemId;
export const LearnerId = (value: string): LearnerId => value as LearnerId;

export const newAttemptId = (): AttemptId => AttemptId(`att_${randomUUID()}`);

/** Injectable clock so time-dependent behaviour stays testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

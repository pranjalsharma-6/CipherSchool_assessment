import { ProblemId } from '../shared/ids.js';
import { Rubric, type RubricDimensionId } from './Rubric.js';

export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * A single thing the design must do, expressed the way the learner reads it,
 * plus the vocabulary that signals it was handled.
 *
 * `signals` exist because there is no single correct LLD answer. A parking-lot
 * design can charge by `PricingStrategy`, `FeeCalculator` or `RateCard` and be
 * equally good, so the deterministic checker matches a *set* of synonyms and
 * reports "not detected" rather than "wrong" — it can only ever raise a
 * question for the learner, never fail them outright.
 */
export interface Requirement {
  readonly id: string;
  readonly text: string;
  /** Lower-cased terms; any match counts the requirement as addressed. */
  readonly signals: readonly string[];
  /** Requirements a learner is expected to notice unprompted. */
  readonly kind: 'stated' | 'implied';
}

/**
 * A concept the reference design models as its own abstraction.
 *
 * Again keyed by aliases, and again advisory: missing one produces a prompt
 * ("nothing in your design owns pricing — was that deliberate?"), not a
 * deduction for disagreeing with the reference.
 */
export interface ExpectedConcept {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly why: string;
}

/** A mistake seen often enough on this problem to be worth naming explicitly. */
export interface Pitfall {
  readonly id: string;
  readonly summary: string;
  /** Terms whose *presence* suggests the learner fell into it. */
  readonly triggers: readonly string[];
  readonly guidance: string;
}

export interface ProblemProps {
  readonly id: ProblemId;
  readonly slug: string;
  readonly title: string;
  readonly difficulty: Difficulty;
  readonly summary: string;
  readonly statement: string;
  readonly requirements: readonly Requirement[];
  readonly constraints: readonly string[];
  readonly expectedConcepts: readonly ExpectedConcept[];
  readonly pitfalls: readonly Pitfall[];
  readonly discussionPrompts: readonly string[];
  readonly tags: readonly string[];
  readonly rubric: Rubric;
  readonly estimatedMinutes: number;
}

/**
 * A practice problem. Immutable — problems are authored content, not something
 * the learner journey mutates, so there are no setters to reason about.
 */
export class Problem {
  readonly id: ProblemId;
  readonly slug: string;
  readonly title: string;
  readonly difficulty: Difficulty;
  readonly summary: string;
  readonly statement: string;
  readonly requirements: readonly Requirement[];
  readonly constraints: readonly string[];
  readonly expectedConcepts: readonly ExpectedConcept[];
  readonly pitfalls: readonly Pitfall[];
  readonly discussionPrompts: readonly string[];
  readonly tags: readonly string[];
  readonly rubric: Rubric;
  readonly estimatedMinutes: number;

  constructor(props: ProblemProps) {
    this.id = props.id;
    this.slug = props.slug;
    this.title = props.title;
    this.difficulty = props.difficulty;
    this.summary = props.summary;
    this.statement = props.statement;
    this.requirements = props.requirements;
    this.constraints = props.constraints;
    this.expectedConcepts = props.expectedConcepts;
    this.pitfalls = props.pitfalls;
    this.discussionPrompts = props.discussionPrompts;
    this.tags = props.tags;
    this.rubric = props.rubric;
    this.estimatedMinutes = props.estimatedMinutes;
  }

  statedRequirements(): readonly Requirement[] {
    return this.requirements.filter((r) => r.kind === 'stated');
  }

  weightOf(dimension: RubricDimensionId): number {
    return this.rubric.dimension(dimension).weight;
  }
}

export { ProblemId };

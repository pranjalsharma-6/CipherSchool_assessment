import type { EvaluationContext } from '../../Evaluator.js';
import { clampScore } from '../../Evaluator.js';
import { matchedTerms, type CheckResult, type DesignCheck } from '../DesignCheck.js';

/** Phrases that appear when someone is comparing two options rather than listing one. */
const REASONING_SIGNALS = [
  'because', 'instead of', 'rather than', 'trade-off', 'tradeoff', 'alternative',
  'considered', 'chose', 'downside', 'cost', 'simpler', 'we could', 'at the expense',
  'over', 'versus', 'vs',
];

/**
 * Did the learner justify the design, or just present it?
 *
 * Deliberately the *only* signal this check reads is length and comparison
 * vocabulary: whether the argument is any good is a judgement the LLM half
 * makes. This half just refuses to let an unjustified design score full marks,
 * which it can do cheaply and without an API call.
 */
export class TradeoffCheck implements DesignCheck {
  readonly id = 'tradeoff-articulation';
  readonly dimension = 'tradeoff_reasoning' as const;

  run({ design }: EvaluationContext): CheckResult {
    const narrative = design.narrative.trim();
    const words = narrative.split(/\s+/).filter(Boolean).length;
    const signals = matchedTerms(narrative.toLowerCase(), REASONING_SIGNALS);

    if (words === 0) {
      return {
        score: 0,
        rationale: 'No trade-off notes were provided.',
        feedback: [
          {
            id: 'no-tradeoffs',
            kind: 'gap' as const,
            dimension: this.dimension,
            title: 'No reasoning given for the design',
            detail:
              'Two or three sentences: what was the main decision, what was the alternative, and why did you pick this one? In an interview this is most of the signal: the classes alone rarely separate candidates.',
          },
        ],
      };
    }

    let score = Math.min(55, Math.round(words * 1.6));
    score += Math.min(45, 11 * signals.length);

    const feedback = [];
    if (signals.length === 0) {
      feedback.push({
        id: 'assertions-not-reasoning',
        kind: 'suggestion' as const,
        dimension: this.dimension,
        title: 'Your notes describe the design rather than argue for it',
        detail:
          'Name one alternative you rejected and what it would have cost. "Composition over inheritance because a vehicle can change size class" is worth more than a paragraph restating the diagram.',
      });
    } else if (words < 40) {
      feedback.push({
        id: 'brief-reasoning',
        kind: 'suggestion' as const,
        dimension: this.dimension,
        title: 'The reasoning is on the right track but thin',
        detail: `You compare options (${signals.slice(0, 3).join(', ')}) but in ${words} words. One more sentence on what your choice makes harder would round it out.`,
      });
    } else {
      feedback.push({
        id: 'reasoned-design',
        kind: 'strength' as const,
        dimension: this.dimension,
        title: 'The design is argued, not just described',
        detail: `${words} words of reasoning with explicit comparison (${signals.slice(0, 4).join(', ')}).`,
      });
    }

    return {
      score: clampScore(score),
      rationale: `${words} words of notes with ${signals.length} comparison markers.`,
      feedback,
    };
  }
}

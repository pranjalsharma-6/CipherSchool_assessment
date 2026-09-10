import type { EvaluationContext } from '../../Evaluator.js';
import { clampScore } from '../../Evaluator.js';
import { matchedTerms, type CheckResult, type DesignCheck } from '../DesignCheck.js';

/** Naming that signals a swappable policy rather than a hard-coded rule. */
const POLICY_SIGNALS = [
  'strategy', 'policy', 'rule', 'provider', 'factory', 'adapter', 'observer',
  'listener', 'subscriber', 'repository', 'gateway', 'visitor', 'state',
  'command', 'decorator', 'builder',
];

/** Phrases that usually accompany a hard-coded branch over a closed set. */
const BRANCHING_SIGNALS = ['switch (', 'switch(', 'if type ==', 'instanceof', 'elif type'];

/**
 * Would this design survive the next requirement?
 *
 * The heuristic: extensible designs name a seam. An abstract type, an interface,
 * or a `…Strategy`/`…Policy` collaborator means new behaviour arrives as a new
 * class; a switch over an enum means it arrives as an edit to existing code. The
 * check rewards the former and asks about the latter rather than forbidding it —
 * a two-case switch is often the right, simpler answer.
 */
export class ExtensibilityCheck implements DesignCheck {
  readonly id = 'extensibility-seams';
  readonly dimension = 'extensibility' as const;

  run({ design }: EvaluationContext): CheckResult {
    const abstractions = design.entities.filter((e) => e.kind === 'interface');
    const polymorphic = design.relationships.filter(
      (r) => r.kind === 'implements' || r.kind === 'inheritance',
    );
    const policyNames = matchedTerms(design.searchText, POLICY_SIGNALS);
    const branching = BRANCHING_SIGNALS.filter((s) => design.searchText.includes(s));

    const feedback = [];
    let score = 45; // A design with no seams at all is mediocre, not failing.

    if (abstractions.length > 0) {
      score += 20;
      feedback.push({
        id: 'has-interfaces',
        kind: 'strength' as const,
        dimension: this.dimension,
        title: `${abstractions.map((e) => e.name).join(', ')} give${abstractions.length === 1 ? 's' : ''} the design a seam`,
        detail:
          'New behaviour can arrive as a new implementation rather than an edit to existing classes.',
      });
    }
    if (polymorphic.length > 0) score += 12;
    if (policyNames.length > 0) {
      score += Math.min(23, 8 * policyNames.length);
      feedback.push({
        id: 'policy-objects',
        kind: 'strength' as const,
        dimension: this.dimension,
        title: 'Varying behaviour is modelled as its own object',
        detail: `Detected: ${policyNames.join(', ')}. Pulling the parts that change into their own type is what keeps the rest of the design stable.`,
      });
    }

    if (abstractions.length === 0 && polymorphic.length === 0 && policyNames.length === 0) {
      feedback.push({
        id: 'no-seams',
        kind: 'gap' as const,
        dimension: this.dimension,
        title: 'No extension point in the design',
        detail:
          'Pick the rule most likely to change — pricing, allocation, notification — and ask what it would take to add a second version of it. If the answer is "edit an existing class", that rule wants to be an interface.',
      });
    }

    if (branching.length > 0) {
      score -= 10;
      feedback.push({
        id: 'type-branching',
        kind: 'question' as const,
        dimension: this.dimension,
        title: 'Behaviour appears to branch on a type value',
        detail:
          'Branching on a kind/enum works until the third variant. If you expect more, the branches are usually the methods of a small family of classes. If the set really is closed, say so — that is a legitimate trade-off.',
      });
    }

    return {
      score: clampScore(score),
      rationale: `${abstractions.length} interfaces, ${polymorphic.length} polymorphic links, ${policyNames.length} policy-style collaborators.`,
      feedback,
    };
  }
}

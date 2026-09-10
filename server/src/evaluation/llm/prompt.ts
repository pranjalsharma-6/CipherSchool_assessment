import type { EvaluationContext } from '../Evaluator.js';
import type { EvaluationContribution } from '../Evaluator.js';
import { DIMENSION_LABELS } from '../../domain/problem/Rubric.js';

/** Dimensions the model is asked to judge; the rest belong to the rule engine. */
export const LLM_DIMENSIONS = [
  'abstraction_quality',
  'relationships',
  'extensibility',
  'edge_cases',
  'tradeoff_reasoning',
] as const;

/**
 * The reviewer persona.
 *
 * Three instructions here exist because of how the model behaved without them:
 * without the "more than one correct design" clause it graded against the
 * reference concepts and marked down every unconventional-but-sound answer;
 * without the quoting rule it produced fluent, generic advice that could have
 * been written before reading the submission; and without the explicit ban on
 * re-checking requirement coverage it duplicated the deterministic findings and
 * sometimes contradicted them, which is worse than saying nothing.
 */
export const SYSTEM_PROMPT = `You are a staff engineer reviewing a learner's low-level design. You have run design interviews for years and you are generous with your reasoning but honest about weaknesses.

Rules you must follow:
1. There is more than one correct design for any of these problems. Judge the design on its own internal logic — whether responsibilities are coherent, relationships are right, and the reasoning holds — never on how closely it resembles a reference solution. A design that differs from convention but is justified is a good design.
2. Every point you make must quote or name something specific from the learner's submission. If you cannot point at their words, do not make the point.
3. Do not comment on whether the stated requirements are covered. A separate deterministic check owns that and its findings are given to you below. Do not repeat or contradict them.
4. Be concrete about what to change. "Consider the single responsibility principle" is useless; "Vehicle both stores its plate and computes its own fee — move the fee logic behind a PricingStrategy so a new rate card does not touch Vehicle" is useful.
5. Score each dimension 0-100 against what a strong candidate would produce in a 45-minute interview, not against a perfect design. 50 is an average attempt.

Respond with a single JSON object and nothing else — no prose before or after, no markdown fences.`;

export function buildUserPrompt(
  context: EvaluationContext,
  deterministic: EvaluationContribution,
): string {
  const { problem, design, submission } = context;

  const sections: string[] = [];

  sections.push(`# Problem: ${problem.title}\n${problem.statement}`);

  sections.push(
    `## Requirements given to the learner\n` +
      problem.statedRequirements().map((r) => `- ${r.text}`).join('\n'),
  );

  if (problem.constraints.length > 0) {
    sections.push(`## Constraints\n${problem.constraints.map((c) => `- ${c}`).join('\n')}`);
  }

  // Framed as *a* reference, not *the* answer, to stop the model grading by
  // similarity — see rule 1 in the system prompt.
  if (problem.expectedConcepts.length > 0) {
    sections.push(
      `## Concepts one reasonable reference design models (NOT an answer key — do not penalise a design that solves these differently)\n` +
        problem.expectedConcepts.map((c) => `- ${c.name}: ${c.why}`).join('\n'),
    );
  }

  sections.push(`## The learner's submission (format: ${submission.format})`);

  if (design.entities.length > 0) {
    sections.push(
      `### Classes\n` +
        design.entities
          .map((e) => {
            const members = e.members.length > 0 ? `\n    members: ${e.members.join(', ')}` : '';
            const responsibility = e.responsibility ? `\n    responsibility: ${e.responsibility}` : '';
            return `- ${e.name} (${e.kind})${responsibility}${members}`;
          })
          .join('\n'),
    );
  }

  if (design.relationships.length > 0) {
    sections.push(
      `### Relationships\n` +
        design.relationships
          .map(
            (r) =>
              `- ${r.from} --${r.kind}--> ${r.to}${r.cardinality ? ` [${r.cardinality}]` : ' [cardinality not stated]'}${r.note ? ` (${r.note})` : ''}`,
          )
          .join('\n'),
    );
  }

  if (design.operations.length > 0) {
    sections.push(
      `### Operations\n` +
        design.operations
          .map((o) => `- ${o.owner ? `${o.owner}.` : ''}${o.name}${o.description ? `: ${o.description}` : ''}`)
          .join('\n'),
    );
  }

  if (submission.format === 'code' || submission.format === 'diagram') {
    sections.push(`### Raw ${submission.format} submitted\n\`\`\`\n${submission.source.slice(0, 8000)}\n\`\`\``);
  }

  sections.push(
    `### The learner's own notes on trade-offs and assumptions\n${design.narrative.trim() || '(none provided)'}`,
  );

  const deterministicFindings = deterministic.feedback
    .filter((f) => f.kind !== 'strength')
    .map((f) => `- [${f.dimension}] ${f.title}`)
    .join('\n');
  sections.push(
    `## Findings already reported by the deterministic checker (do not repeat these)\n${
      deterministicFindings || '- none'
    }`,
  );

  // Attempt context lets the model acknowledge progress, which is the whole
  // point of a platform built around repetition rather than one-shot scoring.
  if (context.attemptNumber > 1) {
    sections.push(
      `## Context\nThis is attempt #${context.attemptNumber} at this problem.` +
        (context.previousScore !== null
          ? ` Their previous attempt scored ${context.previousScore}/100. If this attempt fixes something, say so explicitly.`
          : ''),
    );
  }

  sections.push(
    `## Required output\nReturn JSON in exactly this shape:\n` +
      `{\n` +
      `  "summary": "2-3 sentences addressed to the learner: the single most valuable thing to fix next, and what they already got right.",\n` +
      `  "dimensions": [ { "dimension": "<one of: ${LLM_DIMENSIONS.join(' | ')}>", "score": <0-100>, "rationale": "one sentence justifying this score" } ],\n` +
      `  "feedback": [ { "kind": "strength" | "gap" | "suggestion" | "question", "dimension": "<same set>", "title": "short specific headline", "detail": "2-4 sentences naming the class or relationship involved and what to do" } ]\n` +
      `}\n\n` +
      `Include all ${LLM_DIMENSIONS.length} dimensions. Give between 3 and 6 feedback items, at least one of which is a strength.`,
  );

  return sections.join('\n\n');
}

export const DIMENSION_LABEL = DIMENSION_LABELS;

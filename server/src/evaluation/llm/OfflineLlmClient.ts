import type { LlmClient, LlmRequest } from './LlmClient.js';

/**
 * A stand-in reviewer for when no API key is configured.
 *
 * This is not a language model and is never presented as one: it reports
 * `modelId` as `offline-simulated-reviewer`, the API returns that id in the
 * evaluation's provenance, and the UI renders the review with an "offline
 * reviewer" badge. It exists so a fresh clone demonstrates the full loop —
 * including the qualitative half of the rubric — without a key, and so the
 * whole LLM path stays exercised in development rather than only in production.
 *
 * It reads the prompt this codebase builds (see `prompt.ts`) and answers from
 * the structure it finds there, which is enough for shape-level observations
 * but is no substitute for the real reviewer's judgement.
 */
export class OfflineLlmClient implements LlmClient {
  readonly modelId = 'offline-simulated-reviewer';

  async complete(request: LlmRequest): Promise<string> {
    const classes = parseClasses(request.prompt);
    const relationships = parseRelationships(request.prompt);
    const notes = section(request.prompt, "### The learner's own notes on trade-offs and assumptions");
    // The system prompt forbids repeating what the rule engine already found.
    // The stand-in honours that too, or the demo contradicts its own design.
    const alreadyReported = section(
      request.prompt,
      '## Findings already reported by the deterministic checker (do not repeat these)',
    ).toLowerCase();

    const named = classes.map((c) => c.name);
    const interfaces = classes.filter((c) => c.kind === 'interface');
    const undocumented = classes.filter((c) => !c.responsibility);
    const withoutCardinality = relationships.filter((r) => r.cardinalityMissing);
    const noteWords = notes.split(/\s+/).filter(Boolean).length;

    const feedback: FeedbackDraft[] = [];

    if (interfaces.length > 0) {
      feedback.push({
        kind: 'strength',
        dimension: 'extensibility',
        title: `${interfaces[0]?.name} isolates the part most likely to change`,
        detail: `Declaring ${interfaces.map((i) => i.name).join(' and ')} as an interface means a second variant arrives as a new class rather than an edit to the classes that depend on it. That is the property that keeps a design cheap to change.`,
      });
    } else if (named.length > 0) {
      feedback.push({
        kind: 'gap',
        dimension: 'extensibility',
        title: 'Every collaborator is a concrete class',
        detail: `None of ${named.slice(0, 4).join(', ')} is an interface, so any new rule has to be added by editing an existing class. Identify the one rule most likely to have a second version and put it behind an interface.`,
      });
    }

    if (withoutCardinality.length > 0) {
      feedback.push({
        kind: 'suggestion',
        dimension: 'relationships',
        title: `Cardinality is unstated on ${withoutCardinality.length} relationship${withoutCardinality.length > 1 ? 's' : ''}`,
        detail: `${withoutCardinality
          .slice(0, 2)
          .map((r) => `${r.from} → ${r.to}`)
          .join(', ')} do not say how many. Deciding between 1..1 and 1..* is usually where the real modelling question hides.`,
      });
    } else if (relationships.length > 0) {
      feedback.push({
        kind: 'strength',
        dimension: 'relationships',
        title: 'The object graph is specific',
        detail: `All ${relationships.length} relationships state both direction and multiplicity, so the design can be read without guessing at ownership.`,
      });
    }

    // Only the structured format has a responsibility field to leave blank.
    const structuredFormat = request.prompt.includes('(format: structured)');

    if (structuredFormat && undocumented.length > 0) {
      feedback.push({
        kind: 'suggestion',
        dimension: 'abstraction_quality',
        title: `${undocumented.slice(0, 3).map((c) => c.name).join(', ')} have no stated responsibility`,
        detail:
          'Writing the one-line job of each class is the cheapest way to find the class that is quietly doing two things. If the sentence needs an "and", the class probably needs splitting.',
      });
    } else if (structuredFormat && classes.length >= 3) {
      feedback.push({
        kind: 'strength',
        dimension: 'abstraction_quality',
        title: 'Each class states what it is for',
        detail: `${classes.length} types, each with a single stated job — that makes the design reviewable, which is most of what an interviewer is checking.`,
      });
    }

    feedback.push(
      noteWords >= 40
        ? {
            kind: 'strength',
            dimension: 'tradeoff_reasoning',
            title: 'The design is argued rather than asserted',
            detail: `${noteWords} words of reasoning accompany the model. Keep making the rejected alternative explicit — that is what turns a diagram into a design discussion.`,
          }
        : {
            kind: 'gap',
            dimension: 'tradeoff_reasoning',
            title: 'The reasoning behind the structure is thin',
            detail: `Only ${noteWords} words explain why this shape was chosen. Name the alternative you rejected and the cost of your choice; the structure alone rarely distinguishes two candidates.`,
          },
    );

    const fresh = feedback.filter((item) => !overlaps(item.title, alreadyReported));
    const structureScore = score(classes.length >= 4, interfaces.length > 0, undocumented.length === 0);
    const response = {
      summary:
        `Your design puts ${named.length} types on the problem` +
        (interfaces.length > 0 ? `, with ${interfaces[0]?.name} carrying the variation` : '') +
        `. ${
          withoutCardinality.length > 0
            ? 'The clearest next win is pinning down the multiplicities you left open.'
            : noteWords < 40
              ? 'The clearest next win is writing down why this shape beats the alternative.'
              : 'The shape and the reasoning both hold up; push on the failure paths next.'
        }`,
      dimensions: [
        { dimension: 'abstraction_quality', score: structureScore, rationale: 'Based on the number of types and whether each has a single stated job.' },
        { dimension: 'relationships', score: relationships.length === 0 ? 20 : withoutCardinality.length > 0 ? 55 : 80, rationale: 'Based on relationship count, direction and multiplicity.' },
        { dimension: 'extensibility', score: interfaces.length > 0 ? 78 : 45, rationale: 'Based on whether varying behaviour sits behind an abstraction.' },
        { dimension: 'edge_cases', score: /invalid|error|fail|full|retry|concurren|lock/i.test(request.prompt) ? 68 : 35, rationale: 'Based on whether failure and contention paths appear in the design.' },
        { dimension: 'tradeoff_reasoning', score: Math.max(15, Math.min(85, noteWords * 2)), rationale: 'Based on the depth of the written justification.' },
      ],
      feedback: fresh,
    };

    return JSON.stringify(response);
  }
}

interface FeedbackDraft {
  kind: 'strength' | 'gap' | 'suggestion' | 'question';
  dimension: string;
  title: string;
  detail: string;
}

interface ParsedClass {
  name: string;
  kind: string;
  responsibility: string;
}

interface ParsedRelationship {
  from: string;
  to: string;
  cardinalityMissing: boolean;
}

function parseClasses(prompt: string): ParsedClass[] {
  const block = section(prompt, '### Classes');
  const classes: ParsedClass[] = [];
  let current: ParsedClass | null = null;

  for (const line of block.split('\n')) {
    const header = /^- (\w+) \((\w+)\)$/.exec(line.trim());
    if (header?.[1] && header[2]) {
      current = { name: header[1], kind: header[2], responsibility: '' };
      classes.push(current);
      continue;
    }
    const responsibility = /^responsibility:\s*(.+)$/.exec(line.trim());
    if (responsibility?.[1] && current) current.responsibility = responsibility[1];
  }
  return classes;
}

function parseRelationships(prompt: string): ParsedRelationship[] {
  const block = section(prompt, '### Relationships');
  const relationships: ParsedRelationship[] = [];
  for (const line of block.split('\n')) {
    const match = /^- (\w+) --\w+--> (\w+) \[(.+)\]/.exec(line.trim());
    if (match?.[1] && match[2]) {
      relationships.push({
        from: match[1],
        to: match[2],
        cardinalityMissing: match[3] === 'cardinality not stated',
      });
    }
  }
  return relationships;
}

/** Returns the body of a `###` section, up to the next heading. */
function section(prompt: string, heading: string): string {
  const start = prompt.indexOf(heading);
  if (start === -1) return '';
  const from = start + heading.length;
  const next = prompt.indexOf('\n#', from);
  return prompt.slice(from, next === -1 ? undefined : next).trim();
}

/**
 * True when a draft covers the same ground as something already reported.
 * The two evaluators word findings differently, so this compares the
 * distinctive phrases rather than the whole title.
 */
function overlaps(title: string, alreadyReported: string): boolean {
  const PHRASES = [
    'no stated responsibility',
    'cardinality',
    'not connected',
    'doing too much',
    'reasoning',
    'extension point',
    'happy path',
  ];
  const lower = title.toLowerCase();
  return PHRASES.some((phrase) => lower.includes(phrase) && alreadyReported.includes(phrase));
}

const score = (...conditions: boolean[]): number =>
  40 + Math.round((conditions.filter(Boolean).length / conditions.length) * 45);

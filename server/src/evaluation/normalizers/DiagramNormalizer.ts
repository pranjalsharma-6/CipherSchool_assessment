import {
  buildSearchText,
  type DesignEntity,
  type DesignModel,
  type DesignOperation,
  type DesignRelationship,
  type RelationshipKind,
} from '../../domain/attempt/DesignModel.js';
import type { DiagramSubmission } from '../../domain/attempt/Submission.js';
import type { SubmissionNormalizer } from './SubmissionNormalizer.js';

/**
 * Parses a Mermaid `classDiagram`.
 *
 * Mermaid was chosen over an uploaded image because it is text: it diffs
 * between attempts, it renders in the browser with no server-side work, and it
 * carries the two things a picture usually loses: arrow *kind* and
 * cardinality, which are exactly what the relationships rubric grades.
 */
export class DiagramNormalizer implements SubmissionNormalizer<'diagram'> {
  readonly format = 'diagram' as const;

  normalize(submission: DiagramSubmission): DesignModel {
    const entities = new Map<string, DesignEntity>();
    const relationships: DesignRelationship[] = [];
    const operations: DesignOperation[] = [];

    const ensure = (name: string): DesignEntity => {
      const key = name.trim();
      const existing = entities.get(key);
      if (existing) return existing;
      const created: DesignEntity = {
        name: key,
        kind: 'class',
        responsibility: '',
        members: [],
      };
      entities.set(key, created);
      return created;
    };

    let currentBlock: string | null = null;

    for (const rawLine of submission.source.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('%%') || /^classDiagram/i.test(line)) continue;

      if (line === '}') {
        currentBlock = null;
        continue;
      }

      const blockOpen = /^class\s+([A-Za-z_]\w*)\s*\{$/.exec(line);
      if (blockOpen?.[1]) {
        currentBlock = ensure(blockOpen[1]).name;
        continue;
      }

      if (currentBlock) {
        addMember(entities, currentBlock, line, operations);
        continue;
      }

      const relationship = parseRelationship(line);
      if (relationship) {
        ensure(relationship.from);
        ensure(relationship.to);
        relationships.push(relationship);
        continue;
      }

      // `ClassName : +method()` and stereotype/annotation lines.
      const inline = /^([A-Za-z_]\w*)\s*:\s*(.+)$/.exec(line);
      if (inline?.[1] && inline[2]) {
        ensure(inline[1]);
        addMember(entities, inline[1], inline[2], operations);
        continue;
      }

      const bare = /^class\s+([A-Za-z_]\w*)/.exec(line);
      if (bare?.[1]) ensure(bare[1]);
    }

    const base = {
      entities: [...entities.values()],
      relationships,
      operations,
      narrative: submission.tradeoffs,
    };
    return { ...base, searchText: buildSearchText(base, [submission.source]) };
  }
}

function addMember(
  entities: Map<string, DesignEntity>,
  owner: string,
  raw: string,
  operations: DesignOperation[],
): void {
  const entity = entities.get(owner);
  if (!entity) return;

  const stereotype = /<<(\w+)>>/.exec(raw);
  if (stereotype?.[1]) {
    const kind = stereotype[1].toLowerCase();
    entities.set(owner, {
      ...entity,
      kind: kind === 'interface' ? 'interface' : kind === 'enumeration' || kind === 'enum' ? 'enum' : entity.kind,
    });
    return;
  }

  const member = raw.replace(/^[+\-#~]/, '').trim();
  if (!member) return;
  entities.set(owner, { ...entity, members: [...entity.members, member] });
  if (member.includes('(')) {
    const name = member.slice(0, member.indexOf('(')).split(/\s+/).pop() ?? member;
    operations.push({ name, owner, description: '' });
  }
}

/**
 * Mermaid relationship arrows, longest-first so `<|--` is not mistaken for `<|`.
 * Cardinality in Mermaid is a quoted label on either side of the arrow.
 */
const ARROWS: ReadonlyArray<{ token: string; kind: RelationshipKind; reversed: boolean }> = [
  { token: '<|--', kind: 'inheritance', reversed: true },
  { token: '--|>', kind: 'inheritance', reversed: false },
  { token: '<|..', kind: 'implements', reversed: true },
  { token: '..|>', kind: 'implements', reversed: false },
  { token: '*--', kind: 'composition', reversed: false },
  { token: '--*', kind: 'composition', reversed: true },
  { token: 'o--', kind: 'aggregation', reversed: false },
  { token: '--o', kind: 'aggregation', reversed: true },
  { token: '..>', kind: 'dependency', reversed: false },
  { token: '<..', kind: 'dependency', reversed: true },
  { token: '-->', kind: 'association', reversed: false },
  { token: '<--', kind: 'association', reversed: true },
  { token: '--', kind: 'association', reversed: false },
  { token: '..', kind: 'dependency', reversed: false },
];

function parseRelationship(line: string): DesignRelationship | null {
  const [body, note] = splitOnce(line, ':');

  for (const arrow of ARROWS) {
    const at = body.indexOf(arrow.token);
    if (at === -1) continue;

    const leftRaw = body.slice(0, at).trim();
    const rightRaw = body.slice(at + arrow.token.length).trim();
    const left = parseSide(leftRaw);
    const right = parseSide(rightRaw);
    if (!left.name || !right.name) return null;

    const cardinality = [left.cardinality, right.cardinality].filter(Boolean).join(' .. ');
    const relationship: DesignRelationship = arrow.reversed
      ? { from: right.name, to: left.name, kind: arrow.kind }
      : { from: left.name, to: right.name, kind: arrow.kind };

    return {
      ...relationship,
      ...(cardinality ? { cardinality } : {}),
      ...(note?.trim() ? { note: note.trim() } : {}),
    };
  }
  return null;
}

function parseSide(raw: string): { name: string; cardinality?: string } {
  const quoted = /^"([^"]*)"\s*(.*)$|^(.*?)\s*"([^"]*)"$/.exec(raw);
  if (quoted) {
    const cardinality = (quoted[1] ?? quoted[4] ?? '').trim();
    const name = (quoted[2] ?? quoted[3] ?? '').trim();
    return cardinality ? { name, cardinality } : { name };
  }
  return { name: raw.trim() };
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const at = value.indexOf(separator);
  if (at === -1) return [value, undefined];
  return [value.slice(0, at), value.slice(at + 1)];
}

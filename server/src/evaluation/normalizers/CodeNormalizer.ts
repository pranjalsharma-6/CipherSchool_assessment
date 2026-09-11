import {
  buildSearchText,
  type DesignEntity,
  type DesignModel,
  type DesignOperation,
  type DesignRelationship,
} from '../../domain/attempt/DesignModel.js';
import type { CodeSubmission } from '../../domain/attempt/Submission.js';
import type { SubmissionNormalizer } from './SubmissionNormalizer.js';

/**
 * Pulls a design model out of source code with regexes.
 *
 * Deliberately not a real parser. The evaluators need *shape*, which types
 * exist, what extends what, roughly which methods hang off which type, and a
 * per-language AST parser for three languages is a week of work for a sharper
 * answer to a question the LLM half of the pipeline already answers from the
 * raw source. If code submissions turn out to be the popular format, this class
 * is the only thing that has to be replaced.
 */
export class CodeNormalizer implements SubmissionNormalizer<'code'> {
  readonly format = 'code' as const;

  normalize(submission: CodeSubmission): DesignModel {
    const source = stripComments(submission.source, submission.language);
    const entities: DesignEntity[] = [];
    const relationships: DesignRelationship[] = [];
    const operations: DesignOperation[] = [];

    for (const decl of matchAll(source, DECLARATION)) {
      const kindWord = (decl[1] ?? '').toLowerCase();
      const name = decl[2] ?? '';
      if (!name) continue;
      entities.push({
        name,
        kind: kindWord.includes('interface')
          ? 'interface'
          : kindWord.includes('enum')
            ? 'enum'
            : 'class',
        responsibility: '',
        members: methodsOf(source, name),
      });

      // Python writes its base class in the parenthesised group; TypeScript and
      // Java use `extends`. Both mean inheritance.
      for (const parent of [...splitTypes(decl[3]), ...splitTypes(decl[4])]) {
        relationships.push({ from: name, to: parent, kind: 'inheritance' });
      }
      for (const iface of splitTypes(decl[5])) {
        relationships.push({ from: name, to: iface, kind: 'implements' });
      }
    }

    // A field inside A whose type is another declared entity B reads as "A has-a B".
    const declared = new Set(entities.map((e) => e.name));
    for (const entity of entities) {
      const body = bodyOf(source, entity.name);
      if (!body) continue;
      for (const [type, collection] of referencedTypes(body, declared, entity.name)) {
        relationships.push({
          from: entity.name,
          to: type,
          kind: 'association',
          cardinality: collection ? '1..*' : undefined,
        });
      }
    }

    for (const entity of entities) {
      for (const member of entity.members) {
        operations.push({ name: member, owner: entity.name, description: '' });
      }
    }

    const base = {
      entities,
      relationships: dedupeRelationships(relationships),
      operations,
      narrative: submission.tradeoffs,
    };
    // The raw source joins the search text: signals often live in identifiers
    // and string literals that the shallow parse above never turns into entities.
    return { ...base, searchText: buildSearchText(base, [submission.source]) };
  }
}

/**
 * Groups: 1 = class|interface|enum, 2 = name, 3 = extends list, 4 = implements
 * list. Every other group is non-capturing so the indices stay stable when a
 * modifier keyword is added to the alternation.
 */
const DECLARATION =
  /\b(?:export\s+)?(?:public\s+|abstract\s+|final\s+|sealed\s+|static\s+)*(class|interface|enum)\s+([A-Za-z_]\w*)(?:\s*\(\s*([A-Za-z_][\w.]*)?\s*\))?(?:\s+extends\s+([\w\s,<>.]+?))?(?:\s+implements\s+([\w\s,<>.]+?))?\s*[:{\n]/g;

/**
 * Finds declared types referenced from within a class body, and whether the
 * reference is through a collection (which is what makes it `1..*`).
 */
function referencedTypes(
  body: string,
  declared: ReadonlySet<string>,
  self: string,
): Array<[string, boolean]> {
  const found = new Map<string, boolean>();
  for (const match of matchAll(body, TYPE_REFERENCE)) {
    // Alternatives: List<T> | T[] | : T: the first two are collections.
    const [, , generic, arrayOf, plain] = match;
    const type = generic ?? arrayOf ?? plain;
    if (!type || type === self || !declared.has(type)) continue;
    const isCollection = Boolean(generic ?? arrayOf);
    found.set(type, (found.get(type) ?? false) || isCollection);
  }
  return [...found.entries()];
}

/** `List<Booking>`, `Booking[]`, `: Booking`, `Booking booking;`. */
const TYPE_REFERENCE =
  /\b(List|Set|Map|Array|Collection|Dict|Iterable)\s*<\s*(?:[\w.]+\s*,\s*)?([A-Z]\w*)\s*>|\b([A-Z]\w*)\s*\[\]|[:\s]\s*([A-Z]\w*)\s*[;=,)\n]/g;


function methodsOf(source: string, entityName: string): string[] {
  const body = bodyOf(source, entityName);
  if (!body) return [];
  const names = new Set<string>();
  for (const m of matchAll(body, METHOD)) {
    const name = m[1];
    if (name && !RESERVED.has(name)) names.add(name);
  }
  return [...names];
}

const METHOD =
  /(?:^|\n)\s*(?:public|private|protected|static|abstract|async|def|override|final|\s)*([a-zA-Z_]\w*)\s*\(/g;

const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'super', 'this', 'print',
  'println', 'class', 'interface', 'enum', 'new', 'throw',
]);

/** Extracts the brace-balanced body of a named declaration. */
function bodyOf(source: string, name: string): string | null {
  const header = new RegExp(`\\b(?:class|interface|enum)\\s+${escapeRegex(name)}\\b`).exec(source);
  if (!header) return null;
  const open = source.indexOf('{', header.index);
  if (open === -1) {
    // Python: take the indented block that follows the declaration line.
    const lineEnd = source.indexOf('\n', header.index);
    if (lineEnd === -1) return null;
    const rest = source.slice(lineEnd + 1).split('\n');
    const block: string[] = [];
    for (const line of rest) {
      if (line.trim().length > 0 && !/^\s/.test(line)) break;
      block.push(line);
    }
    return block.join('\n');
  }
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

function stripComments(source: string, language: CodeSubmission['language']): string {
  if (language === 'python') return source.replace(/#.*$/gm, '');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function splitTypes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.replace(/<.*>/g, '').trim())
    .filter((t) => t.length > 0 && /^[A-Za-z_]/.test(t));
}

function dedupeRelationships(rels: readonly DesignRelationship[]): DesignRelationship[] {
  const seen = new Map<string, DesignRelationship>();
  for (const r of rels) {
    const key = `${r.from}|${r.to}|${r.kind}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

function matchAll(input: string, pattern: RegExp): RegExpExecArray[] {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const out: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    out.push(match);
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

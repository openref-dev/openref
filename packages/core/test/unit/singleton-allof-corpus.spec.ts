import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeOpenApiDocument,
  parseSpecification,
  schemaIdForReference,
} from '../../src/index';

/**
 * The singleton `allOf` rule of SPEC 5.1.1, checked on the corpus rather than on a fixture.
 *
 * WHY THIS EXISTS SEPARATELY FROM `singleton-allof.spec.ts`, which already covers the rule and
 * both sides of its boundary: the budget fixture of SPEC 20 carries a thousand operations and
 * not one occurrence of this shape, so no budget and no browser baseline can see a regression
 * in the commonest schema shape a NestJS application emits. Filed as F21 in session 27. Changing
 * the fixture moves two budgets and the browser baseline, which is a maintainer decision and not
 * a side effect of a retrofit, so the gap is covered where it is cheap: on real documents, which
 * carry the shape 227 times and cost nothing to re-read.
 *
 * THE COUNT IS ASSERTED, NOT COMPUTED AND PRINTED. A check that reports whatever it finds passes
 * on an empty corpus, and the failure this exists to catch, a rule that quietly stops applying,
 * looks exactly like a smaller count. The numbers below were measured on the corpus committed in
 * T006, and a document added to it moves them on purpose.
 *
 * The classifier below reads the source and the assertion reads the IR. That is the whole design:
 * re-implementing the rule and comparing it with itself would prove nothing, so this says where
 * the shape is written and then asks the normalizer what it did with each position.
 */

const CORPUS = join(import.meta.dirname, '..', 'corpus');

/** SPEC 5.1.1's annotation set, the keys that may sit beside a reference without merging it. */
const ANNOTATION_KEYWORDS = new Set([
  'title',
  'description',
  'deprecated',
  'readOnly',
  'writeOnly',
  'examples',
  'example',
  'default',
]);

/** How many occurrences each corpus document carries, and every other document carries none. */
const OCCURRENCES: Readonly<Record<string, number>> = {
  'box.json': 22,
  'kubernetes-apiextensions-v1.json': 26,
  'kubernetes-apps-v1.json': 179,
};

/** Of the 227, the ones written at a position the IR keeps addressable by name. */
const CHECKABLE_POSITIONS = 214;

/** One occurrence, as the source wrote it. */
interface Occurrence {
  /** Owning document. */
  readonly file: string;
  /** Schema name, when the wrapper sits at `components.schemas.<name>.properties.<property>`. */
  readonly schema?: string;
  /** Property name at that position. */
  readonly property?: string;
  /** The id the branch points at, which is what the IR must hold at this position. */
  readonly target: string;
}

function corpusFiles(): string[] {
  const parsed = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as {
    documents: { file: string }[];
  };
  return parsed.documents.map((entry) => entry.file).sort((a, b) => a.localeCompare(b));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reports the target of a wrapper that keeps its name, or undefined for any other position.
 *
 * One branch, that branch a reference to a named schema, and every key beside the `allOf` an
 * annotation. It is SPEC 5.1.1's condition read off the source text.
 */
function keptNameTarget(node: Record<string, unknown>): string | undefined {
  const branches = node.allOf;
  if (!Array.isArray(branches) || branches.length !== 1) return undefined;

  const only = branches[0];
  if (!isRecord(only) || typeof only.$ref !== 'string') return undefined;

  const target = schemaIdForReference(only.$ref);
  if (target === undefined) return undefined;

  for (const key of Object.keys(node)) {
    if (key !== 'allOf' && !ANNOTATION_KEYWORDS.has(key)) return undefined;
  }

  return target;
}

/** Walks a parsed document and collects every position the rule applies to. */
function occurrencesIn(file: string, document: unknown): Occurrence[] {
  const found: Occurrence[] = [];

  const walk = (node: unknown, path: readonly string[]): void => {
    if (Array.isArray(node)) {
      node.forEach((member, index) => {
        walk(member, [...path, String(index)]);
      });
      return;
    }
    if (!isRecord(node)) return;

    const target = keptNameTarget(node);
    if (target !== undefined) {
      const addressable =
        path.length === 5 &&
        path[0] === 'components' &&
        path[1] === 'schemas' &&
        path[3] === 'properties';

      found.push(
        addressable ? { file, schema: path[2]!, property: path[4]!, target } : { file, target },
      );
    }

    for (const [key, member] of Object.entries(node)) walk(member, [...path, key]);
  };

  walk(document, []);
  return found;
}

const CORPUS_OCCURRENCES: readonly Occurrence[] = corpusFiles().flatMap((file) =>
  occurrencesIn(file, parseSpecification(readFileSync(join(CORPUS, 'documents', file), 'utf8'))),
);

describe('the singleton allOf shape across the corpus', () => {
  it('should be carried by three documents, 227 times, and by no other document', () => {
    // Given the whole corpus of SPEC 21, read as its source rather than as its IR
    const counted: Record<string, number> = {};
    for (const occurrence of CORPUS_OCCURRENCES) {
      counted[occurrence.file] = (counted[occurrence.file] ?? 0) + 1;
    }

    // When
    const total = CORPUS_OCCURRENCES.length;

    // Then
    expect(counted).toEqual(OCCURRENCES);
    expect(total).toBe(227);
  });

  it('should write 214 of the 227 at a position the IR addresses by schema and property', () => {
    // Given, the other thirteen sit inside a request body, inside a nested property or inside a
    // branch of a composed schema, and are covered by the rule's own unit tests rather than here

    // When
    const addressable = CORPUS_OCCURRENCES.filter(
      (occurrence) => occurrence.schema !== undefined,
    ).length;

    // Then
    expect(addressable).toBe(CHECKABLE_POSITIONS);
  });
});

describe('what the normalizer leaves at each of those positions', () => {
  for (const file of Object.keys(OCCURRENCES)) {
    it(`should leave a reference at every wrapped property of ${file}`, () => {
      // Given
      const positions = CORPUS_OCCURRENCES.filter(
        (occurrence) => occurrence.file === file && occurrence.schema !== undefined,
      );
      const document = normalizeOpenApiDocument(
        parseSpecification(readFileSync(join(CORPUS, 'documents', file), 'utf8')),
      );

      // When, each position is asked what the IR holds there
      const actual = positions.map((occurrence) => {
        const property = document.schemas.get(occurrence.schema!)?.normalized?.properties?.[
          occurrence.property!
        ];
        return `${occurrence.schema!}.${occurrence.property!} -> ${property?.$ref ?? 'MERGED'}`;
      });

      // Then, a merge here is the T003-R2 regression and it names the property it happened to
      expect(actual).toEqual(
        positions.map(
          (occurrence) => `${occurrence.schema!}.${occurrence.property!} -> ${occurrence.target}`,
        ),
      );
      expect(positions.length).toBeGreaterThan(0);
    });
  }
});

import type { IRDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { largeDocument } from '../mocks/documents';

/**
 * What the thousand node budgets of SPEC 20 are measured on, held to what SPEC 20 says it is.
 *
 * T016 finding F10: a budget is only as honest as the input it is taken on, and an input that is
 * not stated is not reproducible. SPEC 20 now writes the input down, and this file is what makes
 * that writing true rather than decorative. Every figure asserted here appears in SPEC 20 beside
 * the budgets taken on it, so a change to the fixture fails here and forces the specification to
 * move in the same commit instead of drifting away from it in silence.
 *
 * The figures are exact rather than banded on purpose. A band would let the fixture wander back
 * towards the repeated description it came from, one edit at a time, with nothing red.
 */

/** Words as the corpus measurement counted them, so the two figures are comparable. */
function wordsOf(text: string | undefined): readonly string[] {
  return (text ?? '').toLowerCase().match(/[a-z0-9_]+/gu) ?? [];
}

interface Vocabulary {
  readonly total: number;
  readonly distinct: number;
}

/** Every word of the document a reader can see or search: prose, routes and identifiers. */
function vocabularyOf(document: IRDocument): Vocabulary {
  const seen = new Set<string>();
  let total = 0;

  const add = (text: string | undefined): void => {
    for (const word of wordsOf(text)) {
      seen.add(word);
      total += 1;
    }
  };

  for (const node of document.nodes.values()) {
    add(node.summary);
    add(node.description);
    // The route, which a reader searches by and which the fixture draws from the same grid as
    // the prose. `IRNode` is a union with the channel of SPEC 8, and a channel has no route.
    if ('path' in node) add(node.path);
  }

  for (const [name, schema] of document.schemas.entries()) {
    const normalized = schema.normalized as {
      description?: string;
      properties?: Record<string, { description?: string }>;
    };
    add(name);
    add(normalized.description);
    for (const [property, body] of Object.entries(normalized.properties ?? {})) {
      add(property);
      add(body.description);
    }
  }

  return { total, distinct: seen.size };
}

/** The operation prose lengths, sorted, which is the distribution SPEC 20 names. */
function operationLengths(document: IRDocument): readonly number[] {
  return [...document.nodes.values()]
    .map((node) => wordsOf(`${node.summary ?? ''} ${node.description ?? ''}`).length)
    .sort((left, right) => left - right);
}

function quantile(sorted: readonly number[], probability: number): number {
  return sorted[Math.round((sorted.length - 1) * probability)] ?? 0;
}

describe('the document the SPEC 20 thousand node budgets are taken on', () => {
  it('should carry the operation and schema counts SPEC 20 states', () => {
    // Given, 1.75 schemas per operation, which is 1893 over 1082 across the three largest real
    // references this project holds: stripe.yaml, box.json and twilio-api-v2010.yaml.
    // When
    const document = largeDocument(1000);

    // Then
    expect(document.nodes.size).toBe(1000);
    expect(document.schemas.size).toBe(1750);
  }, 120_000);

  it('should carry the vocabulary SPEC 20 states', () => {
    // Given, the axis the old fixture had none of. Its whole vocabulary was one sentence.
    // When
    const vocabulary = vocabularyOf(largeDocument(1000));

    // Then, against 204,334 words and 8,335 distinct across the 1082 operations and 1893
    // schemas of the same three real documents.
    expect(vocabulary.total).toBe(217_058);
    expect(vocabulary.distinct).toBe(10_355);
  }, 120_000);

  it('should carry the description length distribution SPEC 20 states', () => {
    // Given, drawn from the measured corpus distribution rather than from one constant string:
    // corpus mean 28.2, median 18, ninetieth percentile 59, longest 470.
    // When
    const lengths = operationLengths(largeDocument(1000));
    const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;

    // Then
    expect(Number(mean.toFixed(1))).toBe(29.7);
    expect(quantile(lengths, 0.5)).toBe(18);
    expect(quantile(lengths, 0.9)).toBe(59);
    expect(quantile(lengths, 1)).toBe(447);
  }, 120_000);

  it('should build the same document twice, because a budget is compared across runs', () => {
    // Given, the reason the generator draws from a seeded sequence and not from a clock
    // When
    const builds = [largeDocument(1000), largeDocument(1000)];

    // Then
    expect(builds[0]?.hash).toBe(builds[1]?.hash);
  }, 240_000);
});

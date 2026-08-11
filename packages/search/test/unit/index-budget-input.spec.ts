import { gzipSync } from 'node:zlib';
import { normalizeOpenApiDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex } from '../../src/index';

/**
 * What the search index budget is taken on, per T016.
 *
 * SPEC 20 sets the index at 250 KB gzip for 1000 nodes, and `index-builder.spec.ts` measures
 * that on a document of 1000 operations whose description is ONE STRING REPEATED 1000 TIMES.
 * Gzip is exactly the measurement that repetition flatters, so the figure it produces, 43 KB,
 * says almost nothing about a document with 1000 different descriptions in it.
 *
 * THIS FILE IS A RECORD OF AN OPEN QUESTION AND NOT A PASSING BUDGET. It pins the measured gap
 * so that it lives in the suite rather than in a note nobody re-reads. The question it asks is
 * in `ai-docs/PROJECT_STATE.md` and is the maintainer's: whether the budget means the committed
 * fixture, in which case it is met and this file records the limit of what it proves, or
 * whether it means a document of 1000 nodes, in which case the index is over it and the work is
 * real. The threshold is not touched either way.
 *
 * If the index is later made smaller, or the fixture made representative, the assertions below
 * fail and force the question to be answered again rather than letting it lapse.
 */

/** SPEC 20: search index, 1000 nodes, gzip. */
const INDEX_BUDGET_BYTES = 250 * 1024;

const STEMS = (
  'account address amount balance batch billing cancel capture card channel charge client code ' +
  'collection confirm connector consent country coupon currency customer delivery discount ' +
  'dispute document entity event expiry fee filter gateway identity instrument invoice ledger ' +
  'limit mandate merchant method notification order package partner payment payout plan policy ' +
  'price product profile provider quota rate receipt refund region report reservation resource ' +
  'response risk schedule scope session settlement shipment source split status subscription ' +
  'tax tenant terminal ticket token transfer usage user vendor wallet webhook workflow'
).split(' ');

/** The description every operation of the committed budget fixture carries. */
const REPEATED_DESCRIPTION =
  'Returns a single item together with its metadata, its current status and the ' +
  'links needed to page through the collection it belongs to.';

/**
 * Prose over a vocabulary that grows with the document.
 *
 * A real reference of 1000 operations names hundreds of resources, fields and error codes, so
 * its index carries a term list that grows with it. A fixture whose whole vocabulary is one
 * sentence has no term list to speak of.
 */
function variedProse(seed: number, words: number): string {
  const out: string[] = [];
  let state = seed >>> 0;

  for (let index = 0; index < words; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const stem = STEMS[state % STEMS.length] ?? 'item';
    out.push(`${stem}${String(state % 20000)}`);
  }

  return `${out.join(' ')}.`;
}

function documentOf(
  count: number,
  description: (index: number) => string,
): ReturnType<typeof normalizeOpenApiDocument> {
  const paths: Record<string, unknown> = {};

  for (let index = 0; index < count; index += 1) {
    paths[`/resources/group${String(index % 40)}/item-${String(index)}`] = {
      get: {
        summary: `Fetch item ${String(index)} from group ${String(index % 40)}`,
        description: description(index),
        tags: [`group-${String(index % 40)}`, 'items'],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
        },
      },
    };
  }

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Large API', version: '1' },
    paths,
    components: { schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } } },
  });
}

function gzipBytesOf(count: number, description: (index: number) => string): number {
  const index = buildSearchIndex(documentOf(count, description));
  return gzipSync(Buffer.from(index.serialized, 'utf8')).byteLength;
}

describe('the input the search index budget is measured on', () => {
  it('should compress the committed fixture far below the budget, because it repeats itself', () => {
    // Given, 1000 operations sharing one description.
    // When
    const bytes = gzipBytesOf(1000, () => REPEATED_DESCRIPTION);

    // Then, comfortably inside, and the comfort is the repetition rather than the index
    expect(bytes).toBeLessThan(INDEX_BUDGET_BYTES / 4);
  }, 120_000);

  it('should exceed the same budget on a document of the same size with ordinary variety', () => {
    // Given, 1000 operations with 60 words of description each, over a vocabulary that grows
    // with the document, which is what a reference of this size looks like.
    // When
    const bytes = gzipBytesOf(1000, (index) => variedProse(index + 1, 60));

    // Then, over. Recorded, not excused: no threshold moved and no exception was written.
    expect(bytes).toBeGreaterThan(INDEX_BUDGET_BYTES);
  }, 120_000);

  it('should grow with description length rather than level off', () => {
    // Given, so that the gap above reads as a slope and not as one unlucky fixture.
    // When
    const shorter = gzipBytesOf(1000, (index) => variedProse(index + 1, 24));
    const longer = gzipBytesOf(1000, (index) => variedProse(index + 1, 120));

    // Then
    expect(longer).toBeGreaterThan(shorter * 2);
  }, 240_000);
});

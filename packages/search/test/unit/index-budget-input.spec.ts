import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { normalizeOpenApiDocument, parseSpecification } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { largeDocument } from '../../../render/test/mocks/documents';
import { buildSearchIndex } from '../../src/index';

/**
 * What the search index budget is measured on, per T016 finding F10.
 *
 * A BUDGET IS ONLY AS HONEST AS THE INPUT IT IS TAKEN ON, and this file is the check that says
 * so out loud. SPEC 20 caps the index at 250 KB gzip for 1000 nodes. Until 2026-08-11 it
 * measured that on a document of 1000 operations sharing ONE description and carrying ONE
 * schema. Gzip is precisely the measurement repetition flatters, so the figure it produced, 43
 * KB, said almost nothing about a document with a thousand different descriptions in it, and the
 * budget read as 5.8x of headroom that no real reference has.
 *
 * THE FIX IS NOT A NUMBER, IT IS A COMPARISON WITH REAL DOCUMENTS. The fixture is synthetic
 * because a budget has to be reproducible without the corpus, but a synthetic input can be made
 * cheap again by accident at any time, and nothing about its own size would say so. So the check
 * here is relative: the cost of one index record on the fixture has to sit inside the band the
 * real corpus documents measure. A fixture that stops being representative fails this whether it
 * got cheaper or dearer, which is the property the absolute cap could never have.
 */

/** Corpus documents with enough operations for a per record figure to mean anything. */
const REAL_DOCUMENTS = ['stripe.yaml', 'box.json', 'twilio-api-v2010.yaml'] as const;

/**
 * The band, measured 2026-08-11 over five corpus documents.
 *
 * stripe 71.9 bytes per record, box 83.6, twilio 69.1, kubernetes-apps 81.8, adyen 51.4. The
 * bounds are set outside the widest pair rather than around the three read below, so that adding
 * a corpus document does not move them, and they are wide enough that ordinary drift in the
 * index format does not trip them while a fixture losing its vocabulary does.
 */
const MIN_BYTES_PER_RECORD = 45;
const MAX_BYTES_PER_RECORD = 95;

function corpusDocument(file: string): ReturnType<typeof normalizeOpenApiDocument> {
  const path = join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'core',
    'test',
    'corpus',
    'documents',
    file,
  );

  return normalizeOpenApiDocument(parseSpecification(readFileSync(path, 'utf8')));
}

function bytesPerRecord(document: ReturnType<typeof normalizeOpenApiDocument>): number {
  const index = buildSearchIndex(document);
  return gzipSync(Buffer.from(index.serialized, 'utf8')).byteLength / index.documentCount;
}

describe('the input the search index budget is measured on', () => {
  it('should cost about what a real document costs, per index record', () => {
    // Given the fixture SPEC 20 names and the real documents it stands in for
    // When
    const fixture = bytesPerRecord(largeDocument(1000));

    // Then, measured 64.3 bytes per record against a corpus band of 51.4 to 83.6. This is the
    // assertion that would have caught the old fixture: one description repeated a thousand
    // times cost 43.0 bytes per record with a vocabulary of four words.
    expect(fixture).toBeGreaterThan(MIN_BYTES_PER_RECORD);
    expect(fixture).toBeLessThan(MAX_BYTES_PER_RECORD);
  }, 120_000);

  it('should sit inside the band the real corpus documents measure', () => {
    // Given, so the band above is read off the corpus in this run rather than trusted from a
    // comment. A corpus document drifting out of it means the band is wrong, not the fixture.
    // When
    const measured = REAL_DOCUMENTS.map((file) => bytesPerRecord(corpusDocument(file)));

    // Then
    for (const cost of measured) {
      expect(cost).toBeGreaterThan(MIN_BYTES_PER_RECORD);
      expect(cost).toBeLessThan(MAX_BYTES_PER_RECORD);
    }
  }, 300_000);

  it('should carry a vocabulary that grows with the document, which is what gzip prices', () => {
    // Given the property the old fixture lacked and the reason its figure was meaningless
    const document = largeDocument(1000);
    const words = new Set<string>();

    // When
    for (const node of document.nodes.values()) {
      for (const word of `${node.summary ?? ''} ${node.description ?? ''}`
        .toLowerCase()
        .match(/[a-z0-9_]+/gu) ?? []) {
        words.add(word);
      }
    }

    // Then, the three largest corpus documents carry 1889 distinct words across 1082 operations.
    // The old fixture carried four. Bounded on both sides: a fixture whose every token is unique
    // is as unrepresentative as one that repeats, and it was measuring 439 KB when this was
    // first looked at.
    expect(words.size).toBeGreaterThan(1200);
    expect(words.size).toBeLessThan(4000);
  }, 120_000);
});

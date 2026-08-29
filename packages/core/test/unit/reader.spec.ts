import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isAsyncApiSource,
  NormalizeError,
  normalizeOpenApiDocument,
  normalizeSpecification,
  parseSpecification,
} from '../../src/index';

/**
 * Which reader a specification asks for, per SPEC 8.3 and SPEC 15.2.
 *
 * WHAT THIS EXISTS TO STOP IS A SECOND HOME FOR THE SAME SENTENCE. `@openref/nest` has asked this
 * question of a host's `document` since `T048`; `@openref/federation` asks it of a fetched body and
 * had no answer at all until `T053`, calling the OpenAPI reader unconditionally, so an events
 * remote was refused by name. The predicate and the dispatch are one exported pair, and the
 * control below is what makes the dispatch the thing being tested rather than a normalizer.
 */

const CORPUS = join(__dirname, '..', 'corpus', 'documents');
const EVENTS = join(__dirname, '..', 'events-corpus', 'documents');

function parsed(directory: string, name: string): unknown {
  return parseSpecification(readFileSync(join(directory, name), 'utf8'));
}

describe('isAsyncApiSource', () => {
  it('should answer from the root member both specifications are required to write', () => {
    // Given one document of each family and the shapes that are neither
    // When, Then
    expect(isAsyncApiSource({ asyncapi: '3.0.0' })).toBe(true);
    expect(isAsyncApiSource({ asyncapi: '3.1.0', openapi: '3.1.0' })).toBe(true);
    expect(isAsyncApiSource({ openapi: '3.1.0' })).toBe(false);
    expect(isAsyncApiSource({})).toBe(false);
  });

  it('should read a member that is not a version string as no answer at all', () => {
    // Given the shapes a hostile or truncated document produces. A member that is present and is
    // not a string says nothing about which reader the document needs, and treating truthiness as
    // the answer would send a document with `asyncapi: true` to a reader that cannot read it.
    // When, Then
    expect(isAsyncApiSource({ asyncapi: true })).toBe(false);
    expect(isAsyncApiSource({ asyncapi: 3 })).toBe(false);
    expect(isAsyncApiSource({ asyncapi: null })).toBe(false);
    expect(isAsyncApiSource(null)).toBe(false);
    expect(isAsyncApiSource('asyncapi: 3.0.0')).toBe(false);
    expect(isAsyncApiSource([{ asyncapi: '3.0.0' }])).toBe(false);
  });
});

describe('normalizeSpecification', () => {
  it('should read a real event document with the reader the OpenAPI one refuses it to', () => {
    // Given a published AsyncAPI document, and the reader federation used to call on it
    const document = parsed(EVENTS, 'aai-streetlights-kafka.yml');

    // When the wrong reader is asked first, which is the control: without it, the dispatch below
    // would be indistinguishable from a normalizer that happens to read both
    let refusal: unknown;
    try {
      normalizeOpenApiDocument(document);
    } catch (error) {
      refusal = error;
    }
    const dispatched = normalizeSpecification(document, { documentId: 'orders' });

    // Then the single reader refuses it by name, and the dispatch produces an events document
    expect(refusal).toBeInstanceOf(NormalizeError);
    expect((refusal as NormalizeError).message).toContain('no openapi version field');
    expect(dispatched.kind).toBe('events');
    expect(dispatched.id).toBe('orders');
    expect([...dispatched.nodes.values()].map((node) => node.kind)).toContain('channel');
  });

  it('should read an HTTP document exactly as the OpenAPI reader does, byte for byte', () => {
    // Given a published OpenAPI document. The dispatch must not be a second reading of it, so the
    // two answers are compared by the canonical hash rather than by a spot check
    const document = parsed(CORPUS, 'oai-petstore.yaml');

    // When
    const direct = normalizeOpenApiDocument(document, { documentId: 'petstore' });
    const dispatched = normalizeSpecification(document, { documentId: 'petstore' });

    // Then
    expect(direct.kind).toBe('http');
    expect(dispatched.hash).toBe(direct.hash);
  });

  it('should leave a document declaring neither version to the refusal it always had', () => {
    // Given a document that says nothing about which specification it is. Inventing a message
    // here would hide the one a host has to act on, per SPEC 15.2.
    // When
    let refusal: unknown;
    try {
      normalizeSpecification({ info: { title: 'Nothing', version: '1' }, paths: {} });
    } catch (error) {
      refusal = error;
    }

    // Then
    expect(refusal).toBeInstanceOf(NormalizeError);
    expect((refusal as NormalizeError).message).toContain('no openapi version field');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IRDocument } from '@openref/core';
import {
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  parseSpecification,
} from '@openref/core';
import { mergeDocuments } from '../../src/index';

/**
 * A mixed document, built from a real HTTP corpus document and a real event corpus document.
 *
 * THIS SUITE EXISTS HERE BECAUSE `mixed` HAS EXACTLY ONE PRODUCER AND IT IS NOT A NORMALIZER.
 * `T049`'s definition of done asks that a mixed document carrying both HTTP and channels normalize
 * to `kind: 'mixed'`, and no specification format writes both: OpenAPI 3.x has no `channels` and
 * AsyncAPI 3 has no `paths`, so `normalizeOpenApiDocument` answers `http` always and
 * `normalizeAsyncApiDocument` answers `events` always, both by construction. The only thing in the
 * tree that produces the third kind is `mergeKind` in this package, per SPEC 15.1. So the honest
 * runner for that clause is here: two real published documents, one of each family, merged.
 *
 * IT IS NOT THE SAME CASE AS `merged-document.spec.ts`. That one hands `mergeKind` two fixtures
 * whose `kind` was written by the fixture builder, which proves the function and not the chain.
 * This one starts from bytes on disk that neither this repository nor its fixtures wrote.
 */

const CORE_TEST = join(import.meta.dirname, '..', '..', '..', 'core', 'test');
const HTTP_DOCUMENT = join(CORE_TEST, 'corpus', 'documents', 'oai-petstore.yaml');
const EVENT_DOCUMENT = join(CORE_TEST, 'events-corpus', 'documents', 'aai-streetlights-kafka.yml');

const MERGED = { id: 'platform', info: { title: 'Platform', version: '2026.8' } } as const;

function http(): IRDocument {
  return normalizeOpenApiDocument(parseSpecification(readFileSync(HTTP_DOCUMENT, 'utf8')));
}

function events(): IRDocument {
  return normalizeAsyncApiDocument(parseSpecification(readFileSync(EVENT_DOCUMENT, 'utf8')));
}

describe('a federation of one HTTP corpus document and one event corpus document', () => {
  it('should report the merged kind as mixed, with both node kinds in one map', () => {
    // Given the two documents, each read as its own kind. The merged answer below means nothing
    // unless the inputs really were one of each, so both are asserted before they are merged: a
    // corpus file quietly replaced by one of the other family would otherwise make `mixed`
    // impossible to reach and this case would fail for a reason nobody could read.
    const petstore = http();
    const streetlights = events();
    expect(petstore.kind).toBe('http');
    expect(streetlights.kind).toBe('events');
    expect([...petstore.nodes.values()].map((node) => node.kind)).toContain('operation');
    expect([...streetlights.nodes.values()].map((node) => node.kind)).toContain('channel');

    // When
    const { document } = mergeDocuments(
      [
        { id: 'petstore', document: petstore },
        { id: 'streetlights', document: streetlights },
      ],
      MERGED,
    );

    // Then the merged document says mixed, and both kinds really are in the one node map that
    // SPEC 5.1 keeps them in, in the counts the two sources brought
    const kinds = [...document.nodes.values()].map((node) => node.kind);
    expect(document.kind).toBe('mixed');
    expect(kinds.filter((kind) => kind === 'operation')).toHaveLength(petstore.nodes.size);
    expect(kinds.filter((kind) => kind === 'channel')).toHaveLength(streetlights.nodes.size);
  });

  it('should keep the channel a channel, address, parameters, servers and all', () => {
    // Given the same merge
    const streetlights = events();
    const { document } = mergeDocuments(
      [
        { id: 'petstore', document: http() },
        { id: 'streetlights', document: streetlights },
      ],
      MERGED,
    );

    // When the channel the event document brought is read back out of the merged map
    const source = [...streetlights.nodes.values()].find((node) => node.kind === 'channel');
    const merged = document.nodes.get(`streetlights_${source?.id ?? ''}`);

    // Then it survives as a channel with everything a reader of a channel page needs, rather
    // than as a node the merge flattened into the HTTP shape around it
    expect(source?.kind).toBe('channel');
    expect(merged?.kind).toBe('channel');
    if (merged?.kind !== 'channel' || source?.kind !== 'channel') return;
    expect(merged.address).toBe(source.address);
    expect(merged.parameters).toEqual(source.parameters);
    expect(merged.servers).toEqual(source.servers);
    expect(merged.messages).toHaveLength(source.messages.length);
    expect(merged.serviceId).toBe('streetlights');
  });

  it('should give one hash whichever order the two services are configured in', () => {
    // Given the same two services in both orders
    const services = [
      { id: 'petstore', document: http() },
      { id: 'streetlights', document: events() },
    ];

    // When
    const forwards = mergeDocuments(services, MERGED).document;
    const backwards = mergeDocuments([...services].reverse(), MERGED).document;

    // Then, and the two inputs really were in different orders before the comparison
    expect(services.map((service) => service.id)).toEqual(['petstore', 'streetlights']);
    expect(forwards.hash).toBe(backwards.hash);
    expect(forwards.kind).toBe('mixed');
  });
});

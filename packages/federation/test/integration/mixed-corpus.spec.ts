import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IRDocument } from '@openref/core';
import {
  buildTopology,
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  normalizeSpecification,
  parseSpecification,
} from '@openref/core';
import { mergeDocuments } from '../../src/index';
import type { FederationService } from '../../src/index';

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

  it('should carry both services edges into one graph, per SPEC 9', () => {
    // Given the two documents, whose own edges are asserted first so that the merged list below
    // is a union of two non empty ones rather than a coincidence
    const petstore = http();
    const streetlights = events();
    expect(petstore.relationships).toEqual([]);
    expect(streetlights.relationships.length).toBeGreaterThan(0);

    // When
    const { document } = mergeDocuments(
      [
        { id: 'petstore', document: petstore },
        { id: 'streetlights', document: streetlights },
      ],
      MERGED,
    );

    // Then every edge the event service declared is in the merged graph, with its own name for
    // itself replaced by its federation id and its channels moved into the merged address space
    expect(document.relationships).toHaveLength(streetlights.relationships.length);
    const services = new Set(
      document.relationships.flatMap((edge) => [
        ...(edge.fromKind === 'service' ? [edge.from] : []),
        ...(edge.toKind === 'service' ? [edge.to] : []),
      ]),
    );
    expect([...services]).toEqual(['streetlights']);
    for (const edge of document.relationships) {
      if (edge.fromKind === 'node') expect(document.nodes.has(edge.from)).toBe(true);
      if (edge.toKind === 'node') expect(document.nodes.has(edge.to)).toBe(true);
    }
  });

  it('should link an HTTP handler to another service channel by address, once merged', () => {
    // Given the HTTP service carrying the edge `@ApiPublishes` produces: a node end at one of its
    // own operations and an `event` end naming an address that is documented by the other service
    const streetlights = events();
    const consumed = streetlights.relationships.find(
      (relationship) => relationship.type === 'subscribes' && relationship.fromKind === 'node',
    );
    const consumedNode = streetlights.nodes.get(consumed?.from ?? '');
    const address = consumedNode?.kind === 'channel' ? consumedNode.address : undefined;
    expect(address).toBeDefined();

    const petstore = http();
    const publisher: IRDocument = {
      ...petstore,
      relationships: [
        {
          from: 'get-pets',
          fromKind: 'node',
          to: address ?? '',
          toKind: 'event',
          type: 'publishes',
          confidence: 'declared',
        },
      ],
    };
    expect(publisher.nodes.has('get-pets')).toBe(true);

    // When the two are merged and the graph is built over the merged document
    const { document } = mergeDocuments(
      [
        { id: 'petstore', document: publisher },
        { id: 'streetlights', document: streetlights },
      ],
      MERGED,
    );
    const topology = buildTopology(document);

    // Then the merge resolved the event end onto the other service's channel node, which is the
    // cross service half of SPEC 9 that no single document can reach. Since `T053-R1` that
    // resolution is the merge's answer and the end carries it as a `node` end, so the label a
    // reader sees is the channel's address while the name is the channel itself. The address
    // chosen is one the event service consumes, so the chain the graph now holds is the whole of
    // SPEC 9's diagram: an HTTP operation, an event, and the service that reads it
    const channelId = [...document.nodes.entries()].find(
      ([, node]) => node.kind === 'channel' && node.address === address,
    )?.[0];
    const declared = topology.groups.find((group) => group.from.name === 'petstore_get-pets');
    const target = declared?.edges.find((edge) => edge.type === 'publishes');
    expect(target?.to.kind).toBe('node');
    expect(target?.to.name).toBe(channelId);
    expect(target?.to.label).toBe(address);
    expect(target?.to.nodeId).toBe(channelId);
    expect(target?.deadEnd).toBe(false);
  });
});

/**
 * Every corpus document of one family, read as a service of one estate.
 *
 * @param family - Which corpus directory to read
 * @returns One service per document, ids derived from the file names so they cannot collide
 */
function corpusServices(family: 'corpus' | 'events-corpus'): FederationService[] {
  const directory = join(CORE_TEST, family, 'documents');

  return readdirSync(directory)
    .sort()
    .map((name) => ({
      id: `${family}-${name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
      document: normalizeSpecification(
        parseSpecification(readFileSync(join(directory, name), 'utf8')),
        { documentId: name },
      ),
    }));
}

/** Every end of a document's edges that names an event rather than something the document holds. */
function eventClassEnds(document: IRDocument): string[] {
  return document.relationships.flatMap((edge) => [
    ...(edge.fromKind === 'event' || edge.fromKind === 'undeclared-event' ? [edge.from] : []),
    ...(edge.toKind === 'event' || edge.toKind === 'undeclared-event' ? [edge.to] : []),
  ]);
}

/**
 * The zero half of the `T053-R1` measurement, which had no runner until the second blind review.
 *
 * SPEC 15.1 RECORDS TWO NUMBERS AND ONLY ONE OF THEM WAS RUNNABLE. The class that can carry the
 * defect is an end of kind `event`, produced by `@ApiPublishes` on a handler and by nothing else,
 * so a published specification cannot carry one; the recorded consequence is that the corpus
 * produces none of the class at any size. That is a claim about every corpus document at once, and
 * a claim nothing runs is a claim that goes quietly false, which is the class SPEC 0 names.
 */
describe('the event class over the whole corpus, per SPEC 15.1', () => {
  it('should federate every event corpus document and hold no end of the class', () => {
    // Given every document of the event corpus as its own service
    const services = corpusServices('events-corpus');

    // When they are federated into one estate
    const { document } = mergeDocuments(services, MERGED);
    const topology = buildTopology(document);

    // Then the estate really has a graph, asserted before the absence below so that a zero read
    // over an empty graph cannot pass for a zero read over a full one
    expect(services).toHaveLength(23);
    expect(topology.edgeCount).toBe(91);

    // And not one of those 91 edges carries an end of the class, which is the recorded figure
    expect(eventClassEnds(document)).toEqual([]);
    expect(services.flatMap((service) => eventClassEnds(service.document))).toEqual([]);
  });

  // THE FORTY DOCUMENT ESTATE IS NOT MERGED HERE, AND THE REASON IS A MEASUREMENT. Read
  // instrumented, on the run the coverage gate makes: normalizing the seventeen HTTP corpus
  // documents costs 3,275 ms and merging all forty costs 2,566 ms, so the case sat 841 ms past
  // vitest's 5,000 ms default and turned the coverage gate red. Raising a timeout to fit it would
  // be tuning the instrument to the reading, so the estate's zero is run where it costs nothing
  // instead: `packages/core/test/unit/topology.spec.ts` already walks all forty documents once for
  // its re-fold case, and counts the class on the same walk. The merged edge count for that estate
  // is no longer lost either, and it is not lost anywhere near here: since the SPEC 20 overview cap
  // was re-derived on the forty document estate on 2026-08-30, that estate is a threshold's input,
  // so `packages/nest/test/integration/overview-budget.spec.ts` has to merge it in any case and
  // asserts 95 edges over 68 groups there by exact equality. The merge's own inability to invent
  // the class is proved by the case above at twenty three services.
});

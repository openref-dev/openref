import { describe, expect, it } from 'vitest';
import {
  buildTopology,
  ErrorCode,
  hashDocument,
  NormalizeError,
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  normalizeSpecification,
  type IRDocument,
  type IRRelationship,
} from '../../src/index';

/**
 * The M5 adversarial pass over the events side of `@openref/core`, per `T054`.
 *
 * EACH BLOCK NAMES WHAT IT DROVE AND WHAT CAME BACK, because an adversarial case that does not say
 * what it attacked reads as an ordinary test and gets deleted as one. Two kinds of block live
 * here and they are labelled: a regression, where the attack worked and the code moved, and a
 * measurement, where the attack did not work and the property is pinned so that it goes on not
 * working.
 */

function events(
  channels: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): IRDocument {
  return normalizeAsyncApiDocument({
    asyncapi: '3.0.0',
    info: { title: 'Events', version: '1' },
    channels,
    ...extra,
  });
}

describe('a document that names itself both specifications at once', () => {
  it('should be refused rather than read as one of them with the other half dropped', () => {
    // Given a document declaring both root members and carrying real content on both sides. SPEC
    // 8.3's rule is that a document says which reader it needs; this one says it twice.
    const both = {
      openapi: '3.1.0',
      asyncapi: '3.0.0',
      info: { title: 'Two', version: '1' },
      paths: { '/orders': { get: { responses: { 200: { description: 'ok' } } } } },
      channels: { c: { address: 'orders.created' } },
    };

    // When
    let refusal: unknown;
    try {
      normalizeSpecification(both);
    } catch (error) {
      refusal = error;
    }

    // Then the refusal names both members and both versions, per SPEC 8.3. WHAT IT USED TO DO,
    // measured 2026-08-29 before the guard: it went to the events reader, produced a document of
    // exactly one node, the channel, dropped the HTTP operation whole, left `unreadKeys` empty and
    // reported nothing anywhere, which is a reference drawing a service as serving no endpoint.
    expect(refusal).toBeInstanceOf(NormalizeError);
    expect((refusal as NormalizeError).code).toBe(ErrorCode.NORM_DOCUMENT_INVALID);
    expect((refusal as NormalizeError).message).toContain('openapi 3.1.0');
    expect((refusal as NormalizeError).message).toContain('asyncapi 3.0.0');
  });

  it('should still read each specification on its own, which is the control', () => {
    // Given the same two halves, each in a document that declares one root member
    // When, Then. Without this pair the refusal above would be indistinguishable from a dispatcher
    // that refuses everything.
    expect(
      normalizeSpecification({
        asyncapi: '3.0.0',
        info: { title: 'E', version: '1' },
        channels: { c: { address: 'orders.created' } },
      }).kind,
    ).toBe('events');

    expect(
      normalizeSpecification({
        openapi: '3.1.0',
        info: { title: 'H', version: '1' },
        paths: { '/orders': { get: { responses: { 200: { description: 'ok' } } } } },
      }).kind,
    ).toBe('http');
  });

  it('should read a member that is not a version string as no declaration at all', () => {
    // Given a document whose `asyncapi` member is present and is not a version. It declares one
    // specification, not two, so the refusal above must not fire on it.
    // When, Then
    expect(
      normalizeSpecification({
        asyncapi: true,
        openapi: '3.1.0',
        info: { title: 'H', version: '1' },
        paths: {},
      }).kind,
    ).toBe('http');
  });
});

describe('a channel address written to break something', () => {
  it('should file every address under a prefixed id no HTTP operation can take', () => {
    // Given the characters an AMQP routing key is allowed and a URL path is not, plus the
    // spellings that reach a path join, a slug and a navigation label
    const addresses = [
      'orders.#.*.created',
      'orders/../../etc/passwd',
      '//evil.example.com/x',
      'javascript:alert(1)',
      'get/orders',
      'a\u0000nul',
      '__proto__',
      'AMQP: !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
    ];

    for (const address of addresses) {
      // When
      const document = events({ ch: { address } });
      const node = [...document.nodes.values()][0];

      // Then the address is carried exactly as written, and the id is prefixed, which is the rule
      // SPEC 8.2 states for the reason `get/orders` is on this list: without the prefix that
      // address would take the id of the operation `GET /orders` in a mixed document.
      expect(node?.kind === 'channel' ? node.address : undefined).toBe(address);
      expect(node?.id.startsWith('channel-')).toBe(true);
      expect(document.nodes.size).toBe(1);
    }
  });

  it('should give six addresses that slug to one id six ids, in canonical order', () => {
    // Given six addresses whose slug is empty, which is the collision SPEC 8.2 resolves by suffix.
    // Two of them, `` and ` `, differ by a character the slug throws away; one is entirely outside
    // the slug alphabet.
    const document = events({
      a: { address: '..' },
      b: { address: '.' },
      c: { address: '' },
      d: { address: '#' },
      e: { address: ' ' },
      f: { address: 'ключ.события' },
    });

    // When, Then six channels are six nodes, and no address was lost to another's id
    expect([...document.nodes.keys()]).toEqual([
      'channel-root',
      'channel-root-2',
      'channel-root-3',
      'channel-root-4',
      'channel-root-5',
      'channel-root-6',
    ]);
    expect(
      [...document.nodes.values()].map((node) =>
        node.kind === 'channel' ? node.address : undefined,
      ),
    ).toEqual(['..', '.', '', '#', ' ', 'ключ.события']);
  });
});

describe('an events document built to exhaust something', () => {
  it('should normalize ten thousand channels and a channel of five hundred messages', () => {
    // Given the two shapes `T054` names. Both are asserted by what they produce rather than by a
    // clock, per the standing rule about a bound proved with a stopwatch.
    const channels: Record<string, unknown> = {};
    for (let index = 0; index < 10_000; index += 1) {
      channels[`c${String(index)}`] = { address: `topic.${String(index)}` };
    }

    const messages: Record<string, unknown> = {};
    for (let index = 0; index < 500; index += 1) {
      messages[`m${String(index)}`] = {
        name: `M${String(index)}`,
        payload: { type: 'object', properties: { a: { type: 'string' } } },
      };
    }

    // When
    const wide = events(channels);
    const deep = events({ one: { address: 'one', messages } });

    // Then every channel is a node of its own and every message is carried
    expect(wide.nodes.size).toBe(10_000);
    const deepNode = [...deep.nodes.values()][0];
    expect(deepNode?.kind === 'channel' ? deepNode.messages.length : 0).toBe(500);
  });

  it('should refuse a trait that refers to itself rather than merging forever', () => {
    // Given a message trait whose reference chain returns to itself
    // When, Then the refusal names the chain, which is SPEC 8.2's fail closed rule for a
    // structural reference and not a depth this reader happened to run out of
    expect(() =>
      events(
        {
          ch: {
            address: 'a',
            messages: { m: { traits: [{ $ref: '#/components/messageTraits/x' }] } },
          },
        },
        { components: { messageTraits: { x: { $ref: '#/components/messageTraits/x' } } } },
      ),
    ).toThrow(/returns to/u);
  });

  it('should build a thousand channel reply cycle as an adjacency list and finish', () => {
    // Given a thousand channels each replying on the next, closing on the first, which is a cycle
    // of a thousand nodes and two thousand edges
    const channels: Record<string, unknown> = {};
    const operations: Record<string, unknown> = {};
    for (let index = 0; index < 1000; index += 1) {
      channels[`c${String(index)}`] = { address: `t.${String(index)}` };
      operations[`op${String(index)}`] = {
        action: 'send',
        channel: { $ref: `#/channels/c${String(index)}` },
        reply: { channel: { $ref: `#/channels/c${String((index + 1) % 1000)}` } },
      };
    }

    // When
    const document = events(channels, { operations });
    const topology = buildTopology(document);

    // Then every channel publishes and calls, the graph is one group per source, and nothing in it
    // is a dead end, because every target is itself a source. SPEC 9.5's rule is that the graph is
    // never walked in depth, and a cycle of this size is what would hang a walk.
    expect(document.relationships).toHaveLength(2000);
    expect(topology.edgeCount).toBe(2000);
    expect(topology.groups).toHaveLength(1001);
    expect(topology.groups.flatMap((group) => group.edges).filter((edge) => edge.deadEnd)).toEqual(
      [],
    );
  });

  it('should give one hash whichever order a cyclic document declares its channels in', () => {
    // Given the same cycle written forwards and backwards
    const build = (order: readonly number[]): string => {
      const channels: Record<string, unknown> = {};
      const operations: Record<string, unknown> = {};
      for (const index of order) {
        channels[`c${String(index)}`] = { address: `t.${String(index)}` };
        operations[`op${String(index)}`] = {
          action: 'send',
          channel: { $ref: `#/channels/c${String(index)}` },
          reply: { channel: { $ref: `#/channels/c${String((index + 1) % 50)}` } },
        };
      }
      return hashDocument(events(channels, { operations }));
    };

    const forwards = [...Array(50).keys()];
    const backwards = [...forwards].reverse();

    // When, Then. The distinctness of the two inputs is asserted first, so a hash function that
    // ignored the document would pass this by accident.
    expect(backwards).not.toEqual(forwards);
    expect(build(backwards)).toBe(build(forwards));
  });
});

describe('a relationship pointing at something a hostile document named to look like it', () => {
  it('should keep an event end and a node end of the same spelling apart', () => {
    // Given an HTTP document with one operation, and two edges whose target string is that
    // operation's node id: one declared as an event, one as a node. SPEC 9.1 puts the kind in the
    // type precisely so that these are two different claims.
    const http = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'H', version: '1' },
      paths: { '/orders': { get: { responses: { 200: { description: 'ok' } } } } },
    });
    const nodeId = [...http.nodes.keys()][0] ?? '';
    const edges: readonly IRRelationship[] = [
      {
        from: 's',
        fromKind: 'service',
        to: nodeId,
        toKind: 'event',
        type: 'publishes',
        confidence: 'declared',
      },
      {
        from: 's',
        fromKind: 'service',
        to: nodeId,
        toKind: 'node',
        type: 'publishes',
        confidence: 'declared',
      },
    ];

    // When
    const topology = buildTopology({ ...http, relationships: edges });
    const drawn = topology.groups.flatMap((group) => group.edges);

    // Then the node end resolves and the event end does not, because an event end is an address
    // and this document answers no channel at that address. The subject is asserted present first:
    // the node really is in the document, so the unresolved end is a fact and not an empty map.
    expect(http.nodes.has(nodeId)).toBe(true);
    expect(drawn.map((edge) => [edge.to.kind, edge.to.nodeId, edge.to.outside])).toEqual([
      ['event', undefined, true],
      ['node', nodeId, false],
    ]);
  });

  it('should hold fifty thousand edges as one group per source without walking them', () => {
    // Given a graph far past anything SPEC 9.5.1 measured, over a hundred sources
    const relationships: IRRelationship[] = [];
    for (let index = 0; index < 50_000; index += 1) {
      relationships.push({
        from: `s${String(index % 100)}`,
        fromKind: 'service',
        to: `e${String(index)}`,
        toKind: 'event',
        type: 'publishes',
        confidence: 'declared',
      });
    }

    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'H', version: '1' },
      paths: {},
    });

    // When
    const topology = buildTopology({ ...document, relationships });

    // Then the grouping is by source and the count is the input count, which is what says nothing
    // folded and nothing expanded
    expect(topology.groups).toHaveLength(100);
    expect(topology.edgeCount).toBe(50_000);
  });
});

describe('a message payload whose declared dialect does not match its content', () => {
  it('should carry a body the document mislabelled Avro exactly as the document wrote it', () => {
    // Given a JSON Schema body declared as Avro. The document is wrong; the reference is not the
    // place that decides so, and SPEC 5.2 keeps a non JSON Schema dialect raw.
    const document = events({
      ch: {
        address: 'a',
        messages: {
          m: {
            payload: {
              schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
              schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
            },
          },
        },
      },
    });

    // When
    const node = [...document.nodes.values()][0];
    const payload = node?.kind === 'channel' ? node.messages[0]?.payload : undefined;

    // Then nothing is lost and nothing is translated: the dialect is the document's own word and
    // the body is under it verbatim, so a reader sees what was written rather than a reading of it
    expect(payload?.kind).toBe('inline');
    expect(payload?.kind === 'inline' ? payload.schema.dialect : '').toBe('avro');
    expect(payload?.kind === 'inline' ? payload.schema.raw : undefined).toEqual({
      schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
      schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    });
  });

  it('should empty a body the document mislabelled JSON Schema, which is measured and not fixed here', () => {
    // Given the other direction: an Avro record body declared as JSON Schema. MEASURED 2026-08-29
    // AND LEFT STANDING, which is why this case is written as a measurement rather than as a
    // regression. The schema normalizer keeps the keywords it knows and drops the rest, so `type:
    // 'record'`, `name` and `fields` all vanish and the reader is shown a message whose payload
    // constrains nothing, with no finding anywhere.
    const document = events({
      ch: {
        address: 'a',
        messages: {
          m: {
            payload: {
              schemaFormat: 'application/schema+json;version=draft-07',
              schema: { type: 'record', name: 'Order', fields: [{ name: 'id', type: 'string' }] },
            },
          },
        },
      },
    });

    // When
    const node = [...document.nodes.values()][0];
    const payload = node?.kind === 'channel' ? node.messages[0]?.payload : undefined;

    // Then the body is empty. IT IS NOT AN EVENTS DEFECT AND THAT IS WHY IT IS NOT FIXED HERE: the
    // control below drives the identical body through the OpenAPI reader and gets the identical
    // empty schema, so this is the OpenAPI side silent drop met from a third direction. Changing it
    // moves every corpus document and needs SPEC 5.x, which is not this task's section.
    //
    // IT HAS AN OWNER, AND IT DID NOT WHEN THIS CASE WAS WRITTEN. The comment pointed at a debt
    // list that was a sentence in `ai-docs/PROJECT_STATE.md`, carrying four other drops and not
    // this one, so a measured defect was cited to a paragraph nothing enforces, which is SPEC 0's
    // ninth class. The post-`T054` review filed all of them, this one included, as the section
    // "`T059` The OpenAPI side silent drops, which had a list and no owner" in
    // `ai-docs/BUILD-AMENDMENTS.md`, where an open box keeps `T059` from being ticked over it.
    expect(payload?.kind === 'inline' ? payload.schema.normalized : 'missing').toEqual({});

    const http = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'H', version: '1' },
      paths: {},
      components: {
        schemas: {
          Order: { type: 'record', name: 'Order', fields: [{ name: 'id', type: 'string' }] },
        },
      },
    });
    expect([...http.schemas.values()][0]?.normalized).toEqual({});
    expect(http.unreadKeys ?? []).toEqual([]);
  });
});

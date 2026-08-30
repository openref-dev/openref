import { describe, expect, it } from 'vitest';
import {
  buildDoctorReport,
  buildTopology,
  ErrorCode,
  hashDocument,
  NormalizeError,
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  normalizeSpecification,
  UnsupportedDialectError,
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

  it('should refuse a body the document mislabelled JSON Schema, naming the format and the position', () => {
    // Given the other direction: an Avro record body declared as JSON Schema. MEASURED 2026-08-29
    // AND REFUSED SINCE 2026-08-30, by the seventh row of SPEC 5.4's disposition table. It was
    // written as a measurement rather than as a regression because it had no owner: the comment
    // pointed at a debt list that was a sentence in `ai-docs/PROJECT_STATE.md`, which is SPEC 0's
    // ninth class. The maintainer pulled the row into a directed slice, SPEC 5.4 moved first, and
    // the schema normalizer keeping only the keywords it knows now ends in a refusal rather than in
    // a payload that constrains nothing with no finding anywhere.
    const mislabelled = {
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
    };

    // Then the refusal names the format, the position, and the signal it refused on
    expect(() => events(mislabelled)).toThrow(UnsupportedDialectError);
    expect(() => events(mislabelled)).toThrow(/application\/schema\+json;version=draft-07/);
    expect(() => events(mislabelled)).toThrow(/channel-a\.messages\.m\.payload/);
    expect(() => events(mislabelled)).toThrow(/written as an Avro record/);
    expect(() => events(mislabelled)).toThrow(/Apache Avro Specification/);

    // And the OpenAPI schema position is untouched, which SPEC 5.4 records as a limit rather than
    // leaving it to be discovered: OpenAPI has no `schemaFormat`, so the document named no dialect
    // there, and JSON Schema's own rule is that an unknown keyword is ignored. Refusing here would
    // refuse every document using a vocabulary this reader does not implement yet.
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

  it('should refuse the other two Avro signals and a Protocol Buffers body, and only those', () => {
    // Given the signals SPEC 5.4 enumerates, each decisive on its own: `enum` and `fixed` are not
    // among JSON Schema's seven type names, `symbols` and `size` are not its keywords, and a
    // Protocol Buffers definition is text rather than an object.
    const under = (schema: unknown) => (): IRDocument =>
      events({
        ch: {
          address: 'a',
          messages: { m: { payload: { schemaFormat: 'application/schema+json', schema } } },
        },
      });

    // Then
    expect(under({ type: 'enum', name: 'Colour', symbols: ['RED'] })).toThrow(/an Avro enum/);
    expect(under({ type: 'fixed', name: 'Md5', size: 16 })).toThrow(/an Avro fixed/);
    expect(under({ syntax: 'proto3', message: 'Order' })).toThrow(/a Protocol Buffers definition/);
    expect(under('syntax = "proto3"; message Order { string id = 1; }')).toThrow(
      /a Protocol Buffers definition/,
    );

    // And a JSON Schema body that merely shares a word with one of them is not a signal: `enum` as
    // a keyword is not `type: "enum"`, and `type: "record"` without `name` or `fields` is not the
    // Avro shape the specification defines.
    expect(under({ enum: ['RED', 'GREEN'] })).not.toThrow();
    expect(under({ type: 'string', enum: ['RED'] })).not.toThrow();
  });

  it('should refuse a string body that carries no proto marker on the rule that settles it', () => {
    // Given the over-claim a second blind review found: one condition read "the body is a string",
    // so `''` and `hello` were refused as Protocol Buffers definitions, citing a Language Guide
    // that says nothing about either. Refusing is right; the naming was a guess.
    const under = (schema: unknown) => (): IRDocument =>
      events({
        ch: {
          address: 'a',
          messages: { m: { payload: { schemaFormat: 'application/schema+json', schema } } },
        },
      });

    // Then the reason is JSON Schema's own rule, and Protocol Buffers is not named
    expect(under('hello')).toThrow(UnsupportedDialectError);
    expect(under('hello')).toThrow(/JSON Schema 2020-12 Core, section 4\.3/);
    expect(under('hello')).toThrow(/a schema is an object or a boolean/);
    expect(under('hello')).not.toThrow(/Protocol Buffers/);
    expect(under('')).not.toThrow(/Protocol Buffers/);
    expect(under(42)).toThrow(/written as a number/);
    expect(under([{ type: 'string' }])).toThrow(/written as an array/);

    // And a string that does carry the marker keeps the more specific true statement
    expect(under('syntax = "proto3"; message Order { string id = 1; }')).toThrow(
      /a Protocol Buffers definition/,
    );

    // And a boolean body is a legal schema and is refused by neither
    expect(under(true)).not.toThrow();
    expect(under(false)).not.toThrow();
  });

  it('should not claim a label literally names JSON Schema when it names a compatible dialect', () => {
    // Given the two vendor formats that map to a JSON Schema compatible dialect without being
    // called JSON Schema. SPEC 5.4 says "JSON Schema compatible label" and the message said
    // "which names JSON Schema", which is false of both.
    const under = (schemaFormat: string) => (): IRDocument =>
      events({
        ch: {
          address: 'a',
          messages: {
            m: {
              payload: {
                schemaFormat,
                schema: { type: 'record', name: 'Order', fields: [] },
              },
            },
          },
        },
      });

    // Then
    for (const format of [
      'application/vnd.aai.asyncapi;version=3.0.0',
      'application/vnd.oai.openapi;version=3.0.0',
      'application/schema+json',
    ]) {
      expect(under(format)).toThrow(/names a JSON Schema compatible dialect/);
      expect(under(format)).not.toThrow(/which names JSON Schema,/);
    }
  });

  it('should normalize every standard 2020-12 body this reader has not implemented, without refusing', () => {
    // Given the measurement that narrowed SPEC 5.4's seventh row on the day it was written. Under
    // the first condition, "the reader took nothing", twelve of these fifteen refused; each is
    // legal JSON Schema 2020-12 under a truthful label, so each refusal was a valid document turned
    // away for this reader's own unimplemented vocabulary.
    const bodies: Record<string, Record<string, unknown>> = {
      unevaluatedProperties: { unevaluatedProperties: false },
      unevaluatedItems: { unevaluatedItems: false },
      contentPair: { contentEncoding: 'base64', contentMediaType: 'image/png' },
      $defs: { $defs: { A: { type: 'string' } } },
      $anchor: { $anchor: 'x' },
      $comment: { $comment: 'note' },
      $schema: { $schema: 'https://json-schema.org/draft/2020-12/schema' },
      $vocabulary: { $vocabulary: { 'https://json-schema.org/draft/2020-12/vocab/core': true } },
      contains: { contains: { type: 'string' } },
      contentSchema: { contentSchema: { type: 'string' } },
      dependentSchemas: { dependentSchemas: { a: { type: 'string' } } },
      minMaxContains: { minContains: 1, maxContains: 2 },
    };

    // When
    const refused: string[] = [];
    for (const [label, schema] of Object.entries(bodies)) {
      try {
        events({
          ch: {
            address: 'a',
            messages: { m: { payload: { schemaFormat: 'application/schema+json', schema } } },
          },
        });
      } catch {
        refused.push(label);
      }
    }

    // Then not one of them is refused
    expect(refused).toEqual([]);
  });

  it('should record an empty read loudly, through the channel the events side already uses', () => {
    // Given the idiomatic binary payload, whose two members are both JSON Schema keywords and
    // neither of which this reader implements. It is not a refusal and it is not silence.
    const document = events({
      ch: {
        address: 'a',
        messages: {
          m: {
            payload: {
              schemaFormat: 'application/schema+json',
              schema: { contentEncoding: 'base64', contentMediaType: 'image/png' },
            },
          },
        },
      },
    });

    // When
    const problems = document.readerProblems ?? [];

    // Then the finding names the position and the members that went unread
    expect(problems).toHaveLength(1);
    expect(problems[0]?.subject).toBe('channel-a.messages.m.payload');
    expect(problems[0]?.reason).toContain('took nothing from it');
    expect(problems[0]?.reason).toContain('contentEncoding, contentMediaType');

    // And it reaches the reader through `discovery-incomplete`, which SPEC 7.1 widened to this
    // reader rather than gaining a second code for the same question
    const finding = buildDoctorReport(document).findings.find((entry) => entry.code === 'RT070');
    expect(finding?.message).toContain('channel-a.messages.m.payload');
    expect(finding?.message).toContain('contentEncoding, contentMediaType');
  });

  it('should record nothing at all when the reader did read the body, so the record is not noise', () => {
    // Given a body this reader reads whole
    const document = events({
      ch: {
        address: 'a',
        messages: {
          m: {
            payload: {
              schemaFormat: 'application/schema+json',
              schema: { type: 'object', properties: { a: { type: 'string' } } },
            },
          },
        },
      },
    });

    // Then
    expect(document.readerProblems).toBeUndefined();
    expect(buildDoctorReport(document).findings.filter((e) => e.code === 'RT070')).toEqual([]);
  });

  it('should leave a truthfully labelled dialect and an empty body alone, so the check stays narrow', () => {
    // Given a body that writes nothing, under a format that names JSON Schema. An empty schema is
    // legal and means "anything", so there is no false statement to refuse.
    const empty = events({
      ch: {
        address: 'a',
        messages: {
          m: { payload: { schemaFormat: 'application/schema+json', schema: {} } },
        },
      },
    });

    // When
    const node = [...empty.nodes.values()][0];
    const payload = node?.kind === 'channel' ? node.messages[0]?.payload : undefined;

    // Then
    expect(payload?.kind === 'inline' ? payload.schema.normalized : 'missing').toEqual({});

    // And the same Avro record under the format that names Avro takes the raw path of SPEC 5.2 and
    // never reaches the check at all, which is what keeps the multi format path AsyncAPI depends on
    // working exactly as it did.
    const avro = events({
      ch: {
        address: 'a',
        messages: {
          m: {
            payload: {
              schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
              schema: { type: 'record', name: 'Order', fields: [{ name: 'id', type: 'string' }] },
            },
          },
        },
      },
    });
    const avroNode = [...avro.nodes.values()][0];
    const avroPayload = avroNode?.kind === 'channel' ? avroNode.messages[0]?.payload : undefined;
    expect(avroPayload?.kind === 'inline' ? avroPayload.schema.dialect : '').toBe('avro');
  });
});

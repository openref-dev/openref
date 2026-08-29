import { describe, expect, it } from 'vitest';
import type {
  IRChannel,
  IRChannelOperation,
  IRDocument,
  IRMessage,
  IRSchema,
} from '../../src/index';
import {
  canonicalize,
  CycleDepthError,
  ErrorCode,
  hashDocument,
  isHttpUrl,
  NormalizeError,
  normalizeAsyncApiDocument,
  proxyServers,
  RefResolutionError,
  UnsupportedDialectError,
} from '../../src/index';
import { createAsyncApi30, createAsyncApi31 } from '../mocks/asyncapi.mock';
import { createRandom, shuffleKeys } from '../mocks/document.mock';

function channelsOf(document: IRDocument): IRChannel[] {
  return [...document.nodes.values()].filter((node): node is IRChannel => node.kind === 'channel');
}

function channelById(document: IRDocument, id: string): IRChannel {
  const channel = document.nodes.get(id);
  if (channel?.kind !== 'channel') {
    throw new Error(`the fixture has no channel ${id}, so this case is testing nothing`);
  }
  return channel;
}

function messageOf(channel: IRChannel, id: string): IRMessage {
  const message = channel.messages.find((candidate) => candidate.id === id);
  if (message === undefined) {
    throw new Error(`channel ${channel.id} carries no message ${id}`);
  }
  return message;
}

function operationOf(channel: IRChannel, id: string): IRChannelOperation {
  const operation = channel.operations.find((candidate) => candidate.id === id);
  if (operation === undefined) {
    throw new Error(`channel ${channel.id} carries no operation ${id}`);
  }
  return operation;
}

function inlineSchemaOf(slot: IRMessage['payload']): IRSchema {
  if (slot?.kind !== 'inline') {
    throw new Error('the fixture put a named slot here, so there is no raw payload to read');
  }
  return slot.schema;
}

/** A minimal well formed document, for a case that wants one field wrong and nothing else. */
function minimalDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asyncapi: '3.0.0',
    info: { title: 'Minimal', version: '1.0.0' },
    channels: { ping: { address: 'ping', messages: { hello: { payload: { type: 'string' } } } } },
    operations: { onPing: { action: 'receive', channel: { $ref: '#/channels/ping' } } },
    ...overrides,
  };
}

/**
 * The four objects of a document writing all six members `T048` recorded as unheld.
 *
 * They are named rather than inlined so the presence half of the proof can read each written
 * member off the fixture itself: `bindings` and `security` on the server, `reply`, `security` and
 * `tags` on the operation, and `tags` on the message.
 *
 * NONE OF THE SIX IS UNHELD ANY MORE, AND THE FIXTURE KEEPS WRITING ALL SIX FOR THAT REASON.
 * `T049` measured the six on the event corpus and gave a carrier to the four the maintainer's
 * ruling authorised as the minor half: `operations[].reply`, `operations[].tags`, `messages[].tags`
 * and `servers[].bindings`. `T051` took the breaking half and gave a carrier to the other two, the
 * `security` of a server and of an operation, by growing `IRSecuritySchemeType` from five names to
 * fourteen. So every member this fixture writes is now proved present by the pins below, and a
 * normalizer that stopped carrying one breaks a case here instead of silently taking the document
 * back to two held fields and six lost ones.
 *
 * THE CHANNEL WRITES `parameters` FOR THE SAME REASON, since 2026-08-29.
 */
function droppedFieldsParts() {
  const server = {
    host: 'kafka.example.com:9092',
    protocol: 'kafka',
    bindings: { kafka: { schemaRegistryUrl: 'https://registry.example.com' } },
    security: [{ $ref: '#/components/securitySchemes/sasl' }],
  };
  const message = {
    name: 'OrderPlaced',
    payload: { $ref: '#/components/schemas/Order' },
    tags: [{ name: 'public' }],
  };
  const channel = {
    address: 'orders/{tenant}',
    tags: [{ name: 'orders' }],
    parameters: { tenant: { description: 'the tenant', enum: ['eu', 'us'] } },
    messages: { placed: message },
  };
  const operation = {
    action: 'send',
    channel: { $ref: '#/channels/orders' },
    reply: { channel: { $ref: '#/channels/orders' } },
    security: [{ $ref: '#/components/securitySchemes/sasl' }],
    tags: [{ name: 'internal' }],
  };

  return { server, message, channel, operation };
}

/** That document, whole. */
function droppedFieldsDocument(): Record<string, unknown> {
  const parts = droppedFieldsParts();

  return {
    asyncapi: '3.0.0',
    info: { title: 'Dropped', version: '1.0.0' },
    servers: { broker: parts.server },
    channels: { orders: parts.channel },
    operations: { publishOrderPlaced: parts.operation },
    components: {
      schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } },
      securitySchemes: { sasl: { type: 'scramSha512' } },
    },
  };
}

describe('normalizeAsyncApiDocument version handling', () => {
  it('should produce one IR from a 3.0 document and the same document declaring 3.1', () => {
    // Given
    const thirty = normalizeAsyncApiDocument(createAsyncApi30());
    const thirtyOne = normalizeAsyncApiDocument(createAsyncApi31());

    // The equality below is worth nothing unless the thing being compared was built, so the
    // construction is asserted before the comparison: two channels, four operations between
    // them, three messages, three schemas and a binding block on each level.
    expect(channelsOf(thirty)).toHaveLength(2);
    expect(channelsOf(thirty).flatMap((channel) => channel.operations)).toHaveLength(2);
    expect(channelsOf(thirty).flatMap((channel) => channel.messages)).toHaveLength(3);
    expect([...thirty.schemas.keys()]).toEqual(['Customer', 'Order']);

    // When
    const [left, right] = [canonicalize(thirty), canonicalize(thirtyOne)];

    // Then
    expect(left).toBe(right);
    expect(hashDocument(thirty)).toBe(hashDocument(thirtyOne));
  });

  it('should refuse AsyncAPI 2.x by naming the conversion rather than by failing to parse', () => {
    // Given
    const document = { asyncapi: '2.6.0', info: { title: 'Old', version: '1' } };

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(UnsupportedDialectError);
    expect(act).toThrow(/convert the document to AsyncAPI 3.x first/);
  });

  it('should refuse a version this reader does not know by naming the ones it does', () => {
    // Given
    const document = { asyncapi: '4.0.0', info: { title: 'Future', version: '1' } };

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(/supported versions are 3.0, 3.1/);
  });

  it('should refuse a document with no asyncapi field', () => {
    // Given
    const document = { info: { title: 'Nameless', version: '1' } };

    // When
    let caught: unknown;
    try {
      normalizeAsyncApiDocument(document);
    } catch (error) {
      caught = error;
    }

    // Then
    expect(caught).toBeInstanceOf(NormalizeError);
    expect((caught as NormalizeError).code).toBe(ErrorCode.NORM_DOCUMENT_INVALID);
  });

  it('should carry a ros2 binding, which is the whole delta 3.1 adds over 3.0', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        asyncapi: '3.1.0',
        channels: {
          ping: { address: 'ping', bindings: { ros2: { qosProfile: 'sensor_data' } } },
        },
        operations: {},
      }),
    );

    // When
    const channel = channelById(document, 'channel-ping');

    // Then
    expect(channel.bindings).toEqual({ ros2: { qosProfile: 'sensor_data' } });
  });
});

describe('normalizeAsyncApiDocument document shape', () => {
  it('should describe an AsyncAPI document as an events document', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const kind = document.kind;

    // Then
    expect(kind).toBe('events');
    expect(document.hash).not.toBe('');
    expect(document.webhooks.size).toBe(0);
  });

  it('should file a channel under an id that no HTTP operation id can take', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const ids = [...document.nodes.keys()];

    // Then
    expect(ids).toEqual(['channel-orders-placed', 'channel-shipping-shipmentid-dispatched']);
    // `<method>-<slug>` is the operation id shape of SPEC 5.4, and `channel` is not a method.
    expect(ids.every((id) => id.startsWith('channel-'))).toBe(true);
  });

  it('should give two channels that slug to one id two ids', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        channels: { first: { address: 'a.b' }, second: { address: 'a-b' } },
        operations: {},
      }),
    );

    // When
    const ids = [...document.nodes.keys()];

    // Then
    expect(ids).toEqual(['channel-a-b', 'channel-a-b-2']);
  });

  it('should fall back to the channel key when the document declares no address', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({ channels: { runtimeChannel: {} }, operations: {} }),
    );

    // When
    const channel = channelById(document, 'channel-runtimechannel');

    // Then
    expect(channel.address).toBeUndefined();
  });

  it('should put every channel in the navigation under the tag it declares', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const groups = document.navigation.map((entry) => entry.id);

    // Then
    expect(groups).toContain('group-orders');
    expect(groups).toContain('group-shipping');
    expect(document.navigation.find((entry) => entry.id === 'group-orders')?.children).toEqual([
      expect.objectContaining({ nodeId: 'channel-orders-placed', label: 'Order placed' }),
    ]);
  });

  it('should refuse a value that is not an object at all', () => {
    // Given
    const inputs = ['asyncapi: 3.0.0', 42, null, ['asyncapi']];

    // When
    const codes = inputs.map((input) => {
      try {
        normalizeAsyncApiDocument(input);
        return 'no refusal';
      } catch (error) {
        return error instanceof NormalizeError ? error.code : 'foreign error';
      }
    });

    // Then
    expect(codes).toEqual(Array.from({ length: 4 }, () => ErrorCode.NORM_DOCUMENT_INVALID));
  });

  it('should skip a channel, an operation and a message that are not objects', () => {
    // Given, a document whose containers are right and whose members are not. A malformed member
    // is skipped the way the OpenAPI side skips one, and the readable ones still arrive.
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        servers: 'not a map',
        channels: {
          broken: 'not an object',
          ping: {
            address: 'ping',
            servers: 'not an array',
            messages: { broken: 7, hello: { payload: { type: 'string' } } },
          },
        },
        operations: {
          broken: 12,
          onPing: { action: 'send', channel: { $ref: '#/channels/ping' } },
        },
      }),
    );

    // When
    const channel = channelById(document, 'channel-ping');

    // Then. The channel's `servers` member is not an array, so it is read as one that was not
    // written and falls on the SPEC 8.2 default of every declared server, and this document
    // declares none readably: the empty list below is the whole of that default, not a channel
    // reported as reachable nowhere.
    expect([...document.nodes.keys()]).toEqual(['channel-ping']);
    expect(channel.messages.map((message) => message.id)).toEqual(['hello']);
    expect(channel.operations.map((operation) => operation.id)).toEqual(['onPing']);
    expect(channel.servers).toEqual([]);
    expect(document.servers).toEqual([]);
  });

  it('should read a document that declares servers and nothing else', () => {
    // Given, no `channels` and no `operations` block at all, which is a document describing
    // brokers before anyone has written a channel on them.
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Brokers only', version: '0.1.0' },
      servers: { broker: { host: 'broker.example.com', protocol: 'amqp' } },
    });

    // When
    const shape = { nodes: document.nodes.size, servers: document.servers.length };

    // Then
    expect(shape).toEqual({ nodes: 0, servers: 1 });
    expect(document.kind).toBe('events');
  });

  it('should refuse an info block that names no version', () => {
    // Given
    const document = { asyncapi: '3.0.0', info: { title: 'No version' } };

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(/info requires both a title and a version/);
  });

  it('should skip members that are not objects wherever a document writes one', () => {
    // Given, four positions where a member has to be an object and is not.
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        servers: { broken: 'not an object', good: { host: 'b.example.com', protocol: 'mqtt' } },
        channels: {
          ping: {
            address: 'ping',
            servers: ['not an object', { $ref: '#/servers/good' }],
            messages: {
              hello: {
                correlationId: 'not an object',
                examples: ['not an object', { name: 'ok' }],
              },
            },
          },
        },
        operations: {},
      }),
    );

    // When
    const channel = channelById(document, 'channel-ping');
    const message = messageOf(channel, 'hello');

    // Then
    expect(document.servers.map((server) => server.url)).toEqual(['mqtt://b.example.com']);
    expect(channel.servers).toEqual([{ url: 'mqtt://b.example.com' }]);
    expect(message.correlationId).toBeUndefined();
    expect(Object.keys(message.examples ?? {})).toEqual(['ok']);
  });

  it('should carry descriptions and a document level extension', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        'x-openref-topology': 'orders',
        channels: {
          ping: {
            address: 'ping',
            description: 'the channel description',
            messages: { hello: { description: 'the message description' } },
          },
        },
        operations: {},
      }),
    );

    // When
    const channel = channelById(document, 'channel-ping');

    // Then
    expect(document.extensions).toEqual({ 'x-openref-topology': 'orders' });
    expect(channel.description).toBe('the channel description');
    expect(messageOf(channel, 'hello').description).toBe('the message description');
  });

  it('should carry an x- member of a channel into extensions', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const channel = channelById(document, 'channel-orders-placed');

    // Then
    expect(channel.extensions).toEqual({ 'x-openref-audience': 'partner' });
  });
});

describe('normalizeAsyncApiDocument servers', () => {
  it('should read a broker with its protocol and protocol version', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const [broker, websocket] = document.servers;

    // Then, exactly these members and no others. The fixture's broker declares a `kafka` server
    // binding, which `IRServer` had nowhere to put until `T049` measured the corpus writing one
    // at three positions and the maintainer's ruling authorised the carrier. The equality below
    // is what keeps the reading recorded rather than invisible, in both directions: the binding
    // is carried verbatim, and nothing else has appeared beside it.
    expect(broker).toEqual({
      url: 'kafka://kafka.example.com:9092',
      protocol: 'kafka',
      protocolVersion: '3.5',
      description: 'production broker',
      bindings: { kafka: { schemaRegistryUrl: 'https://registry.example.com' } },
    });
    expect(websocket?.url).toBe('wss://ws.example.com/events');
    expect(websocket?.variables).toEqual({
      tenant: { default: 'public', enum: ['public', 'private'] },
    });
  });

  it('should leave the server list empty rather than invent the OpenAPI default of a slash', () => {
    // Given
    const document = normalizeAsyncApiDocument(minimalDocument({ servers: undefined }));

    // When
    const servers = document.servers;

    // Then
    expect(servers).toEqual([]);
  });

  it('should skip a server that declares no host or no protocol', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        servers: {
          nohost: { protocol: 'kafka' },
          noprotocol: { host: 'broker.example.com' },
          good: { host: 'broker.example.com', protocol: 'kafka' },
        },
      }),
    );

    // When
    const urls = document.servers.map((server) => server.url);

    // Then
    expect(urls).toEqual(['kafka://broker.example.com']);
  });

  it('should produce broker urls the SPEC 14.5 proxy cannot mistake for an http upstream', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const urls = proxyServers(document).map((server) => server.url);

    // Then, the allowlist of SPEC 14.5 is built from exactly these and admits only http schemes,
    // so an events document adds nothing a console could be sent to.
    expect(urls).toEqual(['kafka://kafka.example.com:9092', 'wss://ws.example.com/events']);
    expect(urls.some((url) => isHttpUrl(new URL(url)))).toBe(false);
  });

  it('should give a channel the protocol of its servers when they agree and nothing when not', () => {
    // Given
    const agreeing = normalizeAsyncApiDocument(createAsyncApi30());
    const mixed = normalizeAsyncApiDocument(
      minimalDocument({
        servers: {
          a: { host: 'a.example.com', protocol: 'kafka' },
          b: { host: 'b.example.com', protocol: 'mqtt' },
        },
        channels: { both: { address: 'both' } },
        operations: {},
      }),
    );

    // When
    const one = channelById(agreeing, 'channel-orders-placed');
    const two = channelById(mixed, 'channel-both');

    // Then
    expect(one.protocol).toBe('kafka');
    expect(two.protocol).toBeUndefined();
  });

  it('should give a channel that writes no servers block every server the document declares', () => {
    // Given, two brokers declared out of code point order and a channel that names neither. The
    // absence being read here is the channel's own `servers` key, so the fixture is asked for it
    // before the IR exists: a channel that had quietly grown one would satisfy the equality below
    // while proving the default was never taken.
    const channel = { address: 'orders.placed' };
    expect(Object.hasOwn(channel, 'servers')).toBe(false);
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        servers: {
          zeta: { host: 'z.example.com', protocol: 'kafka' },
          alpha: { host: 'a.example.com', protocol: 'kafka', description: 'the first broker' },
        },
        channels: { orderPlaced: channel },
        operations: {},
      }),
    );

    // When
    const node = channelById(document, 'channel-orders-placed');

    // Then, per the Channel Object's `servers` field in AsyncAPI 3.0 and 3.1, "If `servers` is
    // absent or empty, this channel MUST be available on all the servers defined in the Servers
    // Object". So a reader of this field alone gets both brokers, in the canonical order the
    // document's own list keeps, rather than an empty array saying the channel is on no server.
    expect(document.servers.map((server) => server.url)).toEqual([
      'kafka://a.example.com',
      'kafka://z.example.com',
    ]);
    expect(node.servers).toEqual([
      { url: 'kafka://a.example.com', description: 'the first broker' },
      { url: 'kafka://z.example.com' },
    ]);
    expect(node.protocol).toBe('kafka');
  });

  it('should give a channel that writes an empty servers list exactly the same servers', () => {
    // Given, the second of the two spellings that one sentence names together. It is written as
    // an empty array on the channel, and that is read off the fixture first, because a fixture
    // that had dropped the key would be testing the absent spelling a second time.
    const channel: Record<string, unknown> = { address: 'orders.placed', servers: [] };
    expect(channel.servers).toEqual([]);
    const brokers = {
      zeta: { host: 'z.example.com', protocol: 'kafka' },
      alpha: { host: 'a.example.com', protocol: 'kafka', description: 'the first broker' },
    };
    const written = normalizeAsyncApiDocument(
      minimalDocument({ servers: brokers, channels: { orderPlaced: channel }, operations: {} }),
    );
    const omitted = normalizeAsyncApiDocument(
      minimalDocument({
        servers: brokers,
        channels: { orderPlaced: { address: 'orders.placed' } },
        operations: {},
      }),
    );

    // When
    const node = channelById(written, 'channel-orders-placed');

    // Then, "absent or empty" is one clause of one sentence, so an empty list is not this
    // project's older reading of "said none": SPEC 8.2 used to carry the `security` distinction
    // of SPEC 5.4 over from OpenAPI, and AsyncAPI does not make it. The two spellings produce one
    // channel.
    expect(node.servers).toEqual([
      { url: 'kafka://a.example.com', description: 'the first broker' },
      { url: 'kafka://z.example.com' },
    ]);
    expect(node.servers).toEqual(channelById(omitted, 'channel-orders-placed').servers);
    expect(hashDocument(written)).toBe(hashDocument(omitted));
  });

  it('should refuse a channel that points at something that is not one of its servers', () => {
    // Given, a reference that resolves. A pointer to nothing is refused one step earlier, by the
    // pointer walk, so it would prove the walk rather than this rule.
    const document = minimalDocument({
      servers: { broker: { host: 'broker.example.com', protocol: 'kafka' } },
      channels: {
        ping: { address: 'ping', servers: [{ $ref: '#/components/schemas/NotAServer' }] },
      },
      operations: {},
      components: { schemas: { NotAServer: { type: 'object' } } },
    });

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/names no server this document declares under servers/);
  });
});

describe('normalizeAsyncApiDocument operations', () => {
  it('should read action send and action receive as the two directions of SPEC 8.2', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const send = operationOf(channelById(document, 'channel-orders-placed'), 'publishOrderPlaced');
    const receive = operationOf(
      channelById(document, 'channel-shipping-shipmentid-dispatched'),
      'onShipmentDispatched',
    );

    // Then
    expect(send.direction).toBe('send');
    expect(send.summary).toBe('Publish an order placed event');
    expect(receive.direction).toBe('receive');
    expect(receive.description).toBe('Consumed by the notification service');
  });

  it('should give an operation that names no message every message of its channel', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());
    const channel = channelById(document, 'channel-shipping-shipmentid-dispatched');

    // The default is only meaningful if the channel really has more than one message.
    expect(channel.messages.map((message) => message.id)).toEqual(['dispatched', 'receipt']);

    // When
    const operation = operationOf(channel, 'onShipmentDispatched');

    // Then
    expect(operation.messageIds).toEqual(['dispatched', 'receipt']);
  });

  it('should give an operation that names messages exactly those', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const operation = operationOf(
      channelById(document, 'channel-orders-placed'),
      'publishOrderPlaced',
    );

    // Then
    expect(operation.messageIds).toEqual(['orderPlaced']);
  });

  it('should refuse an operation whose action is neither send nor receive', () => {
    // Given
    const document = minimalDocument({
      operations: { onPing: { action: 'publish', channel: { $ref: '#/channels/ping' } } },
    });

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(NormalizeError);
    expect(act).toThrow(/either send or receive/);
  });

  it('should refuse an operation that points at a channel the document does not list', () => {
    // Given, a channel object that exists in components and is not reachable from the root
    // `channels` block. A pointer at nothing would be refused by the pointer walk instead, and
    // would leave this rule unproved.
    const document = minimalDocument({
      operations: {
        onPing: { action: 'receive', channel: { $ref: '#/components/channels/Unlisted' } },
      },
      components: { channels: { Unlisted: { address: 'unlisted' } } },
    });

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/names no channel this document lists under channels/);
  });

  it('should refuse an operation that names a message of a different channel', () => {
    // Given
    const document = minimalDocument({
      channels: {
        ping: { address: 'ping', messages: { hello: { payload: { type: 'string' } } } },
        pong: { address: 'pong', messages: { other: { payload: { type: 'string' } } } },
      },
      operations: {
        onPing: {
          action: 'receive',
          channel: { $ref: '#/channels/ping' },
          messages: [{ $ref: '#/channels/pong/messages/other' }],
        },
      },
    });

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(/names no message of channel ping/);
  });

  it('should reach a channel written through components and referred to from both places', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        channels: { ping: { $ref: '#/components/channels/Ping' } },
        operations: {
          onPing: { action: 'receive', channel: { $ref: '#/components/channels/Ping' } },
        },
        components: { channels: { Ping: { address: 'ping' } } },
      }),
    );

    // When
    const channel = channelById(document, 'channel-ping');

    // Then
    expect(channel.operations.map((operation) => operation.id)).toEqual(['onPing']);
  });
});

describe('normalizeAsyncApiDocument messages', () => {
  it('should read a payload that references a named schema as a named slot', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const message = messageOf(channelById(document, 'channel-orders-placed'), 'orderPlaced');

    // Then
    expect(message.payload).toEqual({ kind: 'named', schemaId: 'Order' });
    expect(document.schemas.get('Order')?.normalized?.properties?.customer).toEqual({
      $ref: 'Customer',
    });
  });

  it('should read headers, contentType and the correlation id location', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const message = messageOf(channelById(document, 'channel-orders-placed'), 'orderPlaced');

    // Then
    expect(message.contentType).toBe('application/json');
    expect(message.correlationId).toBe('$message.header#/correlationId');
    expect(inlineSchemaOf(message.headers).normalized?.properties?.['x-request-id']).toEqual({
      type: 'string',
    });
  });

  it('should keep both halves of an example, because a message is headers and payload', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const message = messageOf(channelById(document, 'channel-orders-placed'), 'orderPlaced');

    // Then
    expect(message.examples).toEqual({
      accepted: {
        summary: 'a simple order',
        value: { headers: { 'x-request-id': 'a1b2' }, payload: { id: 'ord_1', total: 42 } },
      },
    });
  });

  it('should keep a second example that carries the name of the first', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        channels: {
          ping: {
            address: 'ping',
            messages: {
              hello: {
                examples: [
                  { name: 'one', payload: { a: 1 } },
                  { name: 'one', payload: { a: 2 } },
                ],
              },
            },
          },
        },
        operations: {},
      }),
    );

    // When
    const message = messageOf(channelById(document, 'channel-ping'), 'hello');

    // Then
    expect(Object.keys(message.examples ?? {})).toEqual(['one', 'one-example-2']);
  });
});

describe('normalizeAsyncApiDocument schema dialects', () => {
  it('should keep an Avro payload as raw with its schemaFormat inside it', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const schema = inlineSchemaOf(
      messageOf(channelById(document, 'channel-shipping-shipmentid-dispatched'), 'dispatched')
        .payload,
    );

    // Then
    expect(schema.dialect).toBe('avro');
    expect(schema.normalized).toBeUndefined();
    expect(schema.raw).toEqual({
      schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
      schema: {
        type: 'record',
        name: 'ShipmentDispatched',
        fields: [
          { name: 'id', type: 'string' },
          // The union with null and the default that SPEC 5.2 says a translation would lose,
          // still here because nothing translated it.
          { name: 'carrier', type: ['null', 'string'], default: null },
        ],
      },
    });
  });

  it('should keep a Protobuf payload as raw, source text and all', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const schema = inlineSchemaOf(
      messageOf(channelById(document, 'channel-shipping-shipmentid-dispatched'), 'receipt').payload,
    );

    // Then
    expect(schema.dialect).toBe('protobuf');
    expect(schema.normalized).toBeUndefined();
    expect(schema.raw).toEqual({
      schemaFormat: 'application/vnd.google.protobuf;version=3',
      schema: 'message ShipmentReceipt { string id = 1; int32 parcels = 2; }',
    });
  });

  it('should take a payload with no schemaFormat through the shared pipeline', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        channels: {
          ping: {
            address: 'ping',
            messages: {
              hello: { payload: { type: 'object', properties: { a: { type: 'integer' } } } },
            },
          },
        },
        operations: {},
      }),
    );

    // When
    const schema = inlineSchemaOf(
      messageOf(channelById(document, 'channel-ping'), 'hello').payload,
    );

    // Then
    expect(schema.dialect).toBe('asyncapi-schema');
    expect(schema.raw).toBeUndefined();
    expect(schema.normalized?.properties?.a).toEqual({ type: 'integer' });
  });

  it('should keep a named schema declared as Avro out of the JSON Schema pipeline', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        channels: {
          ping: {
            address: 'ping',
            messages: { hello: { payload: { $ref: '#/components/schemas/Beat' } } },
          },
        },
        operations: {},
        components: {
          schemas: {
            Beat: {
              schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
              schema: { type: 'record', name: 'Beat', fields: [] },
            },
          },
        },
      }),
    );

    // When
    const schema = document.schemas.get('Beat');

    // Then
    expect(messageOf(channelById(document, 'channel-ping'), 'hello').payload).toEqual({
      kind: 'named',
      schemaId: 'Beat',
    });
    expect(schema?.dialect).toBe('avro');
    expect(schema?.normalized).toBeUndefined();
    expect(schema?.raw).toEqual({
      schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
      schema: { type: 'record', name: 'Beat', fields: [] },
    });
  });

  it('should normalize the inner schema of a named JSON Schema compatible multi format entry', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        components: {
          schemas: {
            Thing: {
              schemaFormat: 'application/vnd.aai.asyncapi;version=3.0.0',
              schema: { type: 'object', properties: { a: { type: 'string' } } },
            },
          },
        },
      }),
    );

    // When
    const schema = document.schemas.get('Thing');

    // Then, the `schemaFormat` and `schema` wrapper is not a JSON Schema, so what is normalized
    // is the inner body and not the wrapper.
    expect(schema?.dialect).toBe('asyncapi-schema');
    expect(schema?.raw).toBeUndefined();
    expect(schema?.normalized?.properties?.a).toEqual({ type: 'string' });
    expect(schema?.normalized?.properties?.schema).toBeUndefined();
  });

  it('should refuse a schemaFormat that names no schema language at all', () => {
    // Given
    const document = minimalDocument({
      channels: {
        ping: {
          address: 'ping',
          messages: { hello: { payload: { schemaFormat: '  ', schema: {} } } },
        },
      },
      operations: {},
    });

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(UnsupportedDialectError);
  });
});

describe('normalizeAsyncApiDocument bindings', () => {
  it('should carry a binding for each of amqp, kafka, ws and mqtt into the IR', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const orders = channelById(document, 'channel-orders-placed');
    const shipping = channelById(document, 'channel-shipping-shipmentid-dispatched');

    // Then
    expect(orders.bindings).toEqual({ kafka: { topic: 'orders.placed', partitions: 12 } });
    expect(shipping.bindings).toEqual({
      amqp: { is: 'routingKey', exchange: { name: 'shipping', type: 'topic' } },
      mqtt: { qos: 1, retain: false },
      ws: { method: 'GET' },
    });
  });

  it('should carry a binding on an operation and on a message, not only on a channel', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());
    const channel = channelById(document, 'channel-orders-placed');

    // When
    const operation = operationOf(channel, 'publishOrderPlaced');
    const message = messageOf(channel, 'orderPlaced');

    // Then
    expect(operation.bindings).toEqual({ kafka: { groupId: { type: 'string' } } });
    expect(message.bindings).toEqual({ kafka: { key: { type: 'string' } } });
  });
});

describe('normalizeAsyncApiDocument traits and defaults', () => {
  it('should put an operation trait underneath the operation rather than drop it', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        operations: {
          onPing: {
            action: 'receive',
            channel: { $ref: '#/channels/ping' },
            bindings: { kafka: { groupId: 'readers' } },
            traits: [{ $ref: '#/components/operationTraits/amqp' }],
          },
        },
        components: {
          operationTraits: {
            amqp: { summary: 'from the trait', bindings: { amqp: { ack: false } } },
          },
        },
      }),
    );

    // When
    const operation = operationOf(channelById(document, 'channel-ping'), 'onPing');

    // Then, both binding blocks stand: a trait property never overrides the target's, and the
    // merge descends where both sides hold an object, so `kafka` and `amqp` do not displace
    // each other.
    expect(operation.summary).toBe('from the trait');
    expect(operation.bindings).toEqual({ amqp: { ack: false }, kafka: { groupId: 'readers' } });
  });

  it('should let the message keep its own value where a trait names the same one', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({
        channels: {
          ping: {
            address: 'ping',
            messages: {
              hello: {
                contentType: 'application/cbor',
                traits: [{ contentType: 'application/json', title: 'from the trait' }],
              },
            },
          },
        },
        operations: {},
      }),
    );

    // When
    const message = messageOf(channelById(document, 'channel-ping'), 'hello');

    // Then
    expect(message.contentType).toBe('application/cbor');
    expect(message.title).toBe('from the trait');
  });

  it('should refuse a trait that nests deeper than the merge declares it will go', () => {
    // Given, fifteen levels of object on both sides of one key, which is past the twelve the
    // merge declares. A YAML alias can build this, and an undeclared limit would turn it into a
    // bare RangeError rather than into a refusal with a code.
    const nest = (depth: number, leaf: Record<string, unknown>): Record<string, unknown> => {
      let value: Record<string, unknown> = leaf;
      for (let index = 0; index < depth; index += 1) value = { down: value };
      return value;
    };
    const document = minimalDocument({
      channels: {
        ping: {
          address: 'ping',
          messages: {
            hello: {
              bindings: nest(15, { kafka: { key: 'own' } }),
              traits: [{ bindings: nest(15, { amqp: { ack: true } }) }],
            },
          },
        },
      },
      operations: {},
    });

    // When
    let caught: unknown;
    try {
      normalizeAsyncApiDocument(document);
    } catch (error) {
      caught = error;
    }

    // Then
    expect(caught).toBeInstanceOf(CycleDepthError);
    expect((caught as CycleDepthError).code).toBe(ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED);
  });

  it('should give a message with no content type the document level default', () => {
    // Given
    const document = normalizeAsyncApiDocument(
      minimalDocument({ defaultContentType: 'application/json' }),
    );

    // When
    const message = messageOf(channelById(document, 'channel-ping'), 'hello');

    // Then
    expect(message.contentType).toBe('application/json');
  });
});

describe('normalizeAsyncApiDocument reference safety', () => {
  it('should refuse a structural reference that leaves the document', () => {
    // Given
    const document = minimalDocument({
      channels: { ping: { $ref: 'other.yaml#/channels/ping' } },
      operations: {},
    });

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/rather than in another file/);
  });

  it('should refuse a chain of references that returns to where it started', () => {
    // Given
    const document = minimalDocument({
      channels: { ping: { $ref: '#/components/channels/A' } },
      operations: {},
      components: {
        channels: {
          A: { $ref: '#/components/channels/B' },
          B: { $ref: '#/components/channels/A' },
        },
      },
    });

    // When
    let caught: unknown;
    try {
      normalizeAsyncApiDocument(document);
    } catch (error) {
      caught = error;
    }

    // Then
    expect(caught).toBeInstanceOf(CycleDepthError);
    expect((caught as CycleDepthError).code).toBe(ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED);
  });

  it('should refuse a reference that resolves to nothing', () => {
    // Given
    const document = minimalDocument({
      channels: { ping: { $ref: '#/components/channels/Absent' } },
      operations: {},
    });

    // When
    const act = (): IRDocument => normalizeAsyncApiDocument(document);

    // Then
    expect(act).toThrow(RefResolutionError);
  });
});

describe('normalizeAsyncApiDocument channel parameters', () => {
  /** A document whose one channel has a templated address and the given `parameters` block. */
  function templated(parameters: unknown, components?: unknown): IRChannel {
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.0.0',
      info: { title: 'Templated', version: '1.0.0' },
      channels: { orders: { address: 'orders/{tenant}/{region}', parameters } },
      ...(components === undefined ? {} : { components }),
    });

    return channelById(document, 'channel-orders-tenant-region');
  }

  it('should carry the description of every variable of a templated address into the IR', () => {
    // Given a channel whose address names two variables, each described in words. The address
    // alone says only that something is substituted; the descriptions are what say what.
    const channel = templated({
      tenant: { description: 'the tenant the order belongs to', enum: ['eu', 'us'] },
      region: { description: 'the data region', default: 'eu' },
    });

    // When
    const parameters = channel.parameters;

    // Then, the descriptions are on the parameters and the address still names both variables,
    // so the pair a reader needs is whole rather than half of it surviving.
    expect(channel.address).toBe('orders/{tenant}/{region}');
    expect(parameters?.tenant?.description).toBe('the tenant the order belongs to');
    expect(parameters?.region?.description).toBe('the data region');
    expect(parameters?.tenant?.enum).toEqual(['eu', 'us']);
    expect(parameters?.region?.default).toBe('eu');
  });

  it('should carry all five members the AsyncAPI Parameter Object declares and no more', () => {
    // Given one parameter writing every member of the Parameter Object, plus a member the object
    // does not declare, so the exact equality below reads as a boundary rather than as a copy.
    const channel = templated({
      tenant: {
        enum: ['eu', 'us'],
        default: 'eu',
        description: 'the tenant',
        examples: ['eu', 'us'],
        location: '$message.payload#/tenant',
        // Not a member of the Parameter Object at any version this reads.
        schema: { type: 'string' },
      },
      region: {},
    });

    // When
    const parameters = channel.parameters;

    // Then, exact equality on the whole parameter, the way the dropped fields pin works: a member
    // this normalizer stops carrying, and a member it starts inventing, both break here.
    expect(parameters?.tenant).toEqual({
      enum: ['eu', 'us'],
      default: 'eu',
      description: 'the tenant',
      examples: ['eu', 'us'],
      location: '$message.payload#/tenant',
    });

    // And a parameter that writes nothing is still a declared parameter. The Parameter Object
    // requires no member, so an empty record is what the document said rather than a loss.
    expect(parameters?.region).toEqual({});
    expect(Object.keys(parameters ?? {})).toEqual(['region', 'tenant']);
  });

  it('should resolve a parameter written under components, which the field pattern allows', () => {
    // Given the same two variables, one of them reached through a Reference Object, which is what
    // the Parameters Object's field pattern permits beside a Parameter Object.
    const channel = templated(
      {
        tenant: { $ref: '#/components/parameters/tenant' },
        region: { description: 'the data region' },
      },
      { parameters: { tenant: { description: 'the tenant', enum: ['eu', 'us'] } } },
    );

    // When
    const parameters = channel.parameters;

    // Then the referred parameter arrives whole, under the name the channel filed it under rather
    // than the name components filed it under, because the address names the former.
    expect(parameters?.tenant).toEqual({ enum: ['eu', 'us'], description: 'the tenant' });
    expect(parameters?.region?.description).toBe('the data region');
  });

  it('should leave the block absent on a channel whose document writes none', () => {
    // Given, When, a channel with no `parameters` member, and one whose member is not an object
    const absent = templated(undefined);
    const wrongShape = templated('orders/{tenant}');
    const empty = templated({});

    // Then, absent rather than an empty record, so `parameters` on the node means the document
    // wrote a block. A member of the wrong shape is read as one that was not written, which is
    // how every other member of this normalizer treats a shape it cannot use.
    expect(absent.parameters).toBeUndefined();
    expect(wrongShape.parameters).toBeUndefined();
    expect(empty.parameters).toBeUndefined();
  });

  it('should refuse a parameter reference that leaves the document', () => {
    // Given, a structural reference into another file, which SPEC 8.2 refuses for a channel, a
    // message and a server, and refuses here for the same reason: no id space, no registry.
    const act = (): IRChannel => templated({ tenant: { $ref: 'other.yaml#/x' } });

    // When, Then
    expect(act).toThrow(RefResolutionError);
  });
});

/**
 * A request-reply document: one channel takes the request, another carries the reply.
 *
 * Shaped after the corpus documents that write `reply`, which are Adeo's Kafka request-reply
 * example, both Kraken WebSocket examples and EVerest's system API: every one of them names a
 * second channel and four of the six EVerest replies also name an address expression.
 */
function requestReplyDocument(reply: unknown): Record<string, unknown> {
  return {
    asyncapi: '3.0.0',
    info: { title: 'Costing', version: '1.0.0' },
    channels: {
      request: { address: 'costing/request', messages: { ask: { payload: { type: 'string' } } } },
      response: {
        address: 'costing/response',
        messages: {
          answer: { payload: { type: 'string' } },
          failure: { payload: { type: 'string' } },
        },
      },
    },
    operations: {
      askForCosting: { action: 'send', channel: { $ref: '#/channels/request' }, reply },
    },
  };
}

function replyOf(document: IRDocument): IRChannelOperation['reply'] {
  return operationOf(channelById(document, 'channel-costing-request'), 'askForCosting').reply;
}

describe('normalizeAsyncApiDocument request and reply', () => {
  it('should carry the reply channel as the node id of the channel the document names', () => {
    // Given a reply naming the second channel and an address expression
    const document = normalizeAsyncApiDocument(
      requestReplyDocument({
        channel: { $ref: '#/channels/response' },
        address: { location: '$message.header#/REPLY_TOPIC', description: 'the consumer inbox' },
      }),
    );

    // When
    const reply = replyOf(document);

    // Then the id is the reply channel's, not the operation's own, and the address is the
    // `location` alone: its `description` is prose about the expression, which is the choice
    // `correlationId` already records rather than a second one.
    expect(reply).toEqual({
      channelId: 'channel-costing-response',
      address: '$message.header#/REPLY_TOPIC',
    });
    expect(channelById(document, 'channel-costing-response').id).toBe('channel-costing-response');
  });

  it('should read reply messages as local names inside the reply channel', () => {
    // Given a reply naming two of the reply channel's messages, in the document's own order
    const document = normalizeAsyncApiDocument(
      requestReplyDocument({
        channel: { $ref: '#/channels/response' },
        messages: [
          { $ref: '#/channels/response/messages/failure' },
          { $ref: '#/channels/response/messages/answer' },
        ],
      }),
    );

    // When
    const reply = replyOf(document);

    // Then, and the ids are the reply channel's keys rather than the request channel's
    expect(reply).toEqual({
      channelId: 'channel-costing-response',
      messageIds: ['failure', 'answer'],
    });
    expect(
      channelById(document, 'channel-costing-response').messages.map((message) => message.id),
    ).toEqual(['answer', 'failure']);
  });

  it('should leave reply messages absent rather than filling in every message of the channel', () => {
    // Given a reply naming a channel and no message. AsyncAPI writes the "all messages of the
    // channel" default on the Operation Object and does not write it on the Operation Reply
    // Object, so the reply channel's two messages must not appear here.
    const document = normalizeAsyncApiDocument(
      requestReplyDocument({ channel: { $ref: '#/channels/response' } }),
    );

    // When
    const reply = replyOf(document);

    // Then, and the operation's own `messageIds` shows the default that does exist still applies
    expect(reply).toEqual({ channelId: 'channel-costing-response' });
    expect(
      operationOf(channelById(document, 'channel-costing-request'), 'askForCosting').messageIds,
    ).toEqual(['ask']);
  });

  it('should carry an empty reply, because it says the operation is one half of a pair', () => {
    // Given
    const document = normalizeAsyncApiDocument(requestReplyDocument({}));

    // When
    const reply = replyOf(document);

    // Then, present and empty, which is not the same fact as absent
    expect(reply).toEqual({});
    expect(reply).toBeDefined();
  });

  it('should leave the reply absent on an operation that writes none', () => {
    // Given, the control for the case above: the same document with the member removed
    const document = normalizeAsyncApiDocument(requestReplyDocument(undefined));

    // When
    const reply = replyOf(document);

    // Then
    expect(reply).toBeUndefined();
  });

  it('should refuse a reply naming a channel this document does not list', () => {
    // Given a reply pointing into components, which the root channels block never names
    const act = (): IRDocument =>
      normalizeAsyncApiDocument({
        ...requestReplyDocument({ channel: { $ref: '#/components/channels/elsewhere' } }),
        components: { channels: { elsewhere: { address: 'elsewhere' } } },
      });

    // When, Then
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/names no channel this document lists under channels/);
  });

  it('should refuse a reply message that belongs to another channel', () => {
    // Given a reply on the response channel naming a message of the request channel
    const act = (): IRDocument =>
      normalizeAsyncApiDocument(
        requestReplyDocument({
          channel: { $ref: '#/channels/response' },
          messages: [{ $ref: '#/channels/request/messages/ask' }],
        }),
      );

    // When, Then
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/names no message of channel response/);
  });

  it('should refuse a reply that names messages and no channel to look them up in', () => {
    // Given
    const act = (): IRDocument =>
      normalizeAsyncApiDocument(
        requestReplyDocument({ messages: [{ $ref: '#/channels/response/messages/answer' }] }),
      );

    // When, Then
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/names messages but no channel/);
  });
});

describe('normalizeAsyncApiDocument structural references identify a position', () => {
  it('should read two channels that reference one message as two separate messages', () => {
    // Given the shape the AsyncAPI Initiative's own streetlights examples use: one Message
    // Object in components, referenced by two channels, and one operation per channel naming
    // its own channel's copy. Until `T049` this was refused outright, because the resolved
    // object is one object and the map from it to a position kept whichever channel was walked
    // last, so the other channel's operation reported a message that "is not of" its channel.
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Streetlights', version: '1.0.0' },
      channels: {
        turnOff: {
          address: 'lights/off',
          messages: { off: { $ref: '#/components/messages/cmd' } },
        },
        turnOn: { address: 'lights/on', messages: { on: { $ref: '#/components/messages/cmd' } } },
      },
      operations: {
        commandOff: {
          action: 'send',
          channel: { $ref: '#/channels/turnOff' },
          messages: [{ $ref: '#/channels/turnOff/messages/off' }],
        },
        commandOn: {
          action: 'send',
          channel: { $ref: '#/channels/turnOn' },
          messages: [{ $ref: '#/channels/turnOn/messages/on' }],
        },
      },
      components: { messages: { cmd: { name: 'command', payload: { type: 'string' } } } },
    });

    // When, both channels are read
    const off = channelById(document, 'channel-lights-off');
    const on = channelById(document, 'channel-lights-on');

    // Then each operation names the message of its own channel, and neither channel took the
    // other's. The construction is asserted before the comparison: two channels, one operation
    // and one message each.
    expect([off.operations, on.operations].map((list) => list.length)).toEqual([1, 1]);
    expect([off.messages, on.messages].map((list) => list.length)).toEqual([1, 1]);
    expect(operationOf(off, 'commandOff').messageIds).toEqual(['off']);
    expect(operationOf(on, 'commandOn').messageIds).toEqual(['on']);
  });

  it('should read two root channels that reference one definition as two separate channels', () => {
    // Given one Channel Object in components under two root names, which is the same defect one
    // level up: the object both names resolve to is one object.
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Shared', version: '1.0.0' },
      channels: {
        first: { $ref: '#/components/channels/shared' },
        second: { $ref: '#/components/channels/shared' },
      },
      operations: {
        onFirst: { action: 'receive', channel: { $ref: '#/channels/first' } },
        onSecond: { action: 'send', channel: { $ref: '#/channels/second' } },
      },
      components: { channels: { shared: { address: 'shared', messages: { hello: {} } } } },
    });

    // When, the two channels the one definition produced
    const [first, second] = [...document.nodes.values()].filter(
      (node): node is IRChannel => node.kind === 'channel',
    );

    // Then each carries its own operation rather than both landing on one channel
    expect(document.nodes.size).toBe(2);
    expect(first?.operations.map((operation) => operation.id)).toEqual(['onFirst']);
    expect(second?.operations.map((operation) => operation.id)).toEqual(['onSecond']);
  });

  it('should bind a channel that names one of two server names sharing one definition', () => {
    // Given two server names sharing one definition, and a channel naming the first.
    //
    // WHAT THIS CASE CANNOT SEE, SAID RATHER THAN PASSED OVER. The same position rule was applied
    // to the servers block, because the question there is the same one, but which of the two
    // names the channel ends up bound to is not observable in today's IR: `IRServerOverride`
    // carries a url and a description, both of which come from the shared definition, so `alpha`
    // and `beta` produce byte identical overrides. So this case pins the shape and the count,
    // which it can see, and states that it does not pin the name, which it cannot. The day an
    // override carries anything derived from the name, the fact becomes visible and this case is
    // where it goes. Unlike the two above, this one does not go red on the unfixed code, which
    // was measured rather than assumed.
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Two names', version: '1.0.0' },
      servers: {
        alpha: { $ref: '#/components/servers/broker' },
        beta: { $ref: '#/components/servers/broker' },
      },
      channels: {
        ping: { address: 'ping', servers: [{ $ref: '#/servers/alpha' }] },
      },
      operations: {},
      components: { servers: { broker: { host: 'b.example.com', protocol: 'mqtt' } } },
    });

    // When
    const channel = channelById(document, 'channel-ping');

    // Then the document has both names and the channel is bound to exactly one server, rather
    // than to none, which is what a lookup that missed the position entirely would produce.
    expect(document.servers).toHaveLength(2);
    expect(channel.servers).toEqual([{ url: 'mqtt://b.example.com' }]);
  });
});

describe('normalizeAsyncApiDocument tags on operations and messages', () => {
  it('should carry the tag names of an operation and of a message', () => {
    // Given
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Tagged', version: '1.0.0' },
      channels: {
        orders: {
          address: 'orders',
          messages: { placed: { tags: [{ name: 'public' }, { name: 'v2' }] } },
        },
      },
      operations: {
        publish: {
          action: 'send',
          channel: { $ref: '#/channels/orders' },
          tags: [{ name: 'internal' }],
        },
      },
    });

    // When
    const channel = channelById(document, 'channel-orders');

    // Then, in the order the document wrote them
    expect(operationOf(channel, 'publish').tags).toEqual(['internal']);
    expect(messageOf(channel, 'placed').tags).toEqual(['public', 'v2']);
  });

  it('should leave tags absent where the document wrote none, unlike the channel that must answer', () => {
    // Given the same document with both tag blocks removed
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Untagged', version: '1.0.0' },
      channels: { orders: { address: 'orders', messages: { placed: {} } } },
      operations: { publish: { action: 'send', channel: { $ref: '#/channels/orders' } } },
    });

    // When
    const channel = channelById(document, 'channel-orders');

    // Then absent on both, while the channel answers with the empty list its required member has
    expect(operationOf(channel, 'publish').tags).toBeUndefined();
    expect(messageOf(channel, 'placed').tags).toBeUndefined();
    expect(channel.tags).toEqual([]);
  });
});

/**
 * The thirteen security scheme types AsyncAPI declares, quoted from its own table.
 *
 * WRITTEN OUT HERE RATHER THAN IMPORTED FROM THE NORMALIZER, so the case compares two independent
 * spellings of one list. Importing the constant under test would make this a test of whether a
 * loop iterates its own input.
 */
const THIRTEEN_TYPES = [
  'userPassword',
  'apiKey',
  'X509',
  'symmetricEncryption',
  'asymmetricEncryption',
  'httpApiKey',
  'http',
  'oauth2',
  'openIdConnect',
  'plain',
  'scramSha256',
  'scramSha512',
  'gssapi',
] as const;

/** A document declaring one scheme of each of the thirteen types, referenced from one server. */
function thirteenSchemeDocument(): Record<string, unknown> {
  const schemes: Record<string, unknown> = {};
  for (const type of THIRTEEN_TYPES) {
    const extra: Record<string, unknown> =
      type === 'apiKey'
        ? { in: 'user' }
        : type === 'httpApiKey'
          ? { name: 'token', in: 'query' }
          : type === 'http'
            ? { scheme: 'bearer', bearerFormat: 'JWT' }
            : type === 'oauth2'
              ? {
                  flows: {
                    clientCredentials: {
                      tokenUrl: 'https://auth.example.com/token',
                      availableScopes: { 'orders:read': 'read orders' },
                    },
                  },
                }
              : type === 'openIdConnect'
                ? { openIdConnectUrl: 'https://auth.example.com/.well-known' }
                : {};

    schemes[type] = { type, description: `${type} scheme`, ...extra };
  }

  return {
    asyncapi: '3.1.0',
    info: { title: 'Thirteen', version: '1.0.0' },
    servers: {
      broker: {
        host: 'broker.example.com',
        protocol: 'kafka',
        security: THIRTEEN_TYPES.map((type) => ({
          $ref: `#/components/securitySchemes/${type}`,
        })),
      },
    },
    channels: { orders: { address: 'orders', messages: { placed: {} } } },
    operations: { publish: { action: 'send', channel: { $ref: '#/channels/orders' } } },
    components: { securitySchemes: schemes },
  };
}

describe('normalizeAsyncApiDocument security, per SPEC 8.2', () => {
  it('should read all thirteen AsyncAPI scheme types into the document table', () => {
    // Given a document declaring one scheme of every type the specification's table names, and
    // a server naming all thirteen, so nothing here is measured against an empty haystack
    const source = thirteenSchemeDocument();
    expect(THIRTEEN_TYPES).toHaveLength(13);

    // When
    const document = normalizeAsyncApiDocument(source);

    // Then every one of the thirteen survived, under its declared name, in code point order of
    // that name. A type this reader does not know is refused by the case below, so a name this
    // list gains and the reader does not stops the document rather than shortening this list.
    expect(document.security.map((scheme) => scheme.type)).toEqual([...THIRTEEN_TYPES].sort());
    expect(document.security.map((scheme) => scheme.id)).toEqual([...THIRTEEN_TYPES].sort());
  });

  it('should read only the members the type declares, per the specification Applies To column', () => {
    // Given
    const document = normalizeAsyncApiDocument(thirteenSchemeDocument());
    const byId = new Map(document.security.map((scheme) => [scheme.id, scheme]));

    // When
    const apiKey = byId.get('apiKey');
    const httpApiKey = byId.get('httpApiKey');
    const http = byId.get('http');
    const oauth2 = byId.get('oauth2');
    const openIdConnect = byId.get('openIdConnect');
    const plain = byId.get('plain');

    // Then, and the two `apiKey` vocabularies stay apart: `user` for AsyncAPI's `apiKey`, which
    // has no `name` at all, and `query` for `httpApiKey`, which is OpenAPI's `apiKey` by another
    // name and does have one.
    expect(apiKey).toEqual({
      id: 'apiKey',
      type: 'apiKey',
      description: 'apiKey scheme',
      in: 'user',
    });
    expect(httpApiKey).toEqual({
      id: 'httpApiKey',
      type: 'httpApiKey',
      description: 'httpApiKey scheme',
      name: 'token',
      in: 'query',
    });
    expect(http).toEqual({
      id: 'http',
      type: 'http',
      description: 'http scheme',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    // `availableScopes` is AsyncAPI's name for the dictionary OpenAPI calls `scopes`, and it
    // lands in the same IR field, so a reader of `IROAuthFlow` sees one shape from both.
    expect(oauth2?.flows).toEqual({
      clientCredentials: {
        tokenUrl: 'https://auth.example.com/token',
        scopes: { 'orders:read': 'read orders' },
      },
    });
    expect(openIdConnect?.openIdConnectUrl).toEqual('https://auth.example.com/.well-known');
    // A SASL type declares nothing but a description, so nothing but a description is produced.
    expect(plain).toEqual({ id: 'plain', type: 'plain', description: 'plain scheme' });
  });

  it('should refuse a declared type outside the thirteen, naming the type and the position', () => {
    // Given a document declaring one type the specification's table does not name, beside one it
    // does, so the refusal below is about the unknown type rather than about the block
    const source = {
      asyncapi: '3.1.0',
      info: { title: 'Unknown scheme', version: '1.0.0' },
      channels: { orders: { address: 'orders' } },
      operations: {},
      components: {
        securitySchemes: {
          real: { type: 'plain' },
          invented: { type: 'mutualTLS' },
        },
      },
    };
    expect(
      normalizeAsyncApiDocument({
        ...source,
        components: { securitySchemes: { real: { type: 'plain' } } },
      }).security,
    ).toHaveLength(1);

    // When
    const refusal = (): unknown => normalizeAsyncApiDocument(source);

    // Then, and `mutualTLS` is the pointed case: it is a member of `IRSecuritySchemeType`, so
    // nothing about the type would have stopped it, and AsyncAPI simply does not declare it. The
    // message names the type and the position, because the reader who acts on it edits the
    // document. Before `T051`'s review this skipped, and the position kept an empty list.
    expect(refusal).toThrow(NormalizeError);
    expect(refusal).toThrow('components.securitySchemes.invented');
    expect(refusal).toThrow('"mutualTLS"');
  });

  it('should refuse an inline server scheme of an unknown type rather than emptying the list', () => {
    // Given the probe of `T051`'s review: a server declaring one scheme, of a type nothing
    // declares. The same document with a known type normalizes to one requirement, so the
    // refusal below is about the type and not about the shape of the position.
    const documentWith = (type: string): Record<string, unknown> => ({
      asyncapi: '3.1.0',
      info: { title: 'Inline server scheme', version: '1.0.0' },
      servers: {
        broker: { host: 'b.example.com', protocol: 'kafka', security: [{ type }] },
      },
      channels: { orders: { address: 'orders' } },
      operations: {},
    });
    expect(normalizeAsyncApiDocument(documentWith('plain')).servers[0]?.security).toEqual([
      { schemeId: 'broker-security-0', scopes: [] },
    ]);

    // When
    const refusal = (): unknown => normalizeAsyncApiDocument(documentWith('bearerToken'));

    // Then. An empty list at this position is this reader's own spelling of "the document said
    // there are none", and the document said there is one, so a skip printed a false sentence.
    expect(refusal).toThrow(NormalizeError);
    expect(refusal).toThrow('servers.broker.security[0]');
    expect(refusal).toThrow('"bearerToken"');
  });

  it('should refuse an inline operation scheme of an unknown type at the operation position', () => {
    // Given the same probe one position over, so both positions are measured rather than one
    const documentWith = (type: string): Record<string, unknown> => ({
      asyncapi: '3.1.0',
      info: { title: 'Inline operation scheme', version: '1.0.0' },
      channels: { orders: { address: 'orders' } },
      operations: {
        publish: { action: 'send', channel: { $ref: '#/channels/orders' }, security: [{ type }] },
      },
    });
    const channel = channelById(
      normalizeAsyncApiDocument(documentWith('gssapi')),
      'channel-orders',
    );
    expect(operationOf(channel, 'publish').security).toEqual([
      { schemeId: 'publish-security-0', scopes: [] },
    ]);

    // When
    const refusal = (): unknown => normalizeAsyncApiDocument(documentWith('bearerToken'));

    // Then
    expect(refusal).toThrow(NormalizeError);
    expect(refusal).toThrow('operations.publish.security[0]');
  });

  it('should refuse a scheme that writes no type at all, which the specification requires', () => {
    // Given a declared scheme carrying everything but the one member AsyncAPI marks REQUIRED
    const source = {
      asyncapi: '3.1.0',
      info: { title: 'Typeless scheme', version: '1.0.0' },
      channels: { orders: { address: 'orders' } },
      operations: {},
      components: { securitySchemes: { anonymous: { description: 'no type here' } } },
    };

    // When
    const refusal = (): unknown => normalizeAsyncApiDocument(source);

    // Then, the same refusal: a missing required member and a member outside its declared values
    // are one class here, and `undefined` is named in the message rather than left blank.
    expect(refusal).toThrow(NormalizeError);
    expect(refusal).toThrow('components.securitySchemes.anonymous');
  });

  it('should refuse a reference to an unknown type at the declaration and not at the reference', () => {
    // Given a server referring to a declared scheme whose type is outside the thirteen
    const source = {
      asyncapi: '3.1.0',
      info: { title: 'Referred unknown', version: '1.0.0' },
      servers: {
        broker: {
          host: 'b.example.com',
          protocol: 'kafka',
          security: [{ $ref: '#/components/securitySchemes/odd' }],
        },
      },
      channels: { orders: { address: 'orders' } },
      operations: {},
      components: { securitySchemes: { odd: { type: 'bearerToken' } } },
    };

    // When
    const refusal = (): unknown => normalizeAsyncApiDocument(source);

    // Then the position named is the declaration, because the table is read before the servers
    // and the declaration is the position a reader would have to edit either way.
    expect(refusal).toThrow('components.securitySchemes.odd');
  });

  it('should read the security of a server and of an operation as requirements naming the table', () => {
    // Given, both positions naming the same declared scheme
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Both positions', version: '1.0.0' },
      servers: {
        broker: {
          host: 'broker.example.com',
          protocol: 'kafka',
          security: [{ $ref: '#/components/securitySchemes/sasl' }],
        },
      },
      channels: { orders: { address: 'orders', messages: { placed: {} } } },
      operations: {
        publish: {
          action: 'send',
          channel: { $ref: '#/channels/orders' },
          security: [
            {
              $ref: '#/components/securitySchemes/oauth',
            },
          ],
        },
      },
      components: {
        securitySchemes: {
          sasl: { type: 'scramSha256' },
          oauth: { type: 'oauth2', flows: {}, scopes: ['orders:write'] },
        },
      },
    });

    // When
    const [server] = document.servers;
    const channel = channelById(document, 'channel-orders');

    // Then, one entry per scheme in the document table and a requirement at each position. The
    // scopes come off the scheme object at the position, which is where AsyncAPI writes "the
    // needed scope names", and they are the requirement's rather than the scheme's.
    expect(document.security.map((scheme) => scheme.id)).toEqual(['oauth', 'sasl']);
    expect(server?.security).toEqual([{ schemeId: 'sasl', scopes: [] }]);
    expect(operationOf(channel, 'publish').security).toEqual([
      { schemeId: 'oauth', scopes: ['orders:write'] },
    ]);
  });

  it('should give a scheme written inline an id derived from the position that wrote it', () => {
    // Given a server whose second entry is a whole Security Scheme Object rather than a reference
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Inline', version: '1.0.0' },
      servers: {
        broker: {
          host: 'broker.example.com',
          protocol: 'mqtt',
          security: [
            { $ref: '#/components/securitySchemes/apiKey' },
            { type: 'userPassword', description: 'the broker credentials' },
          ],
        },
      },
      channels: { orders: { address: 'orders' } },
      operations: {},
      components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'password' } } },
    });

    // When
    const [server] = document.servers;

    // Then the declared one keeps its name and the inline one is named after where it stands,
    // with the index it was written at, so two inline schemes on one server stay apart.
    expect(server?.security).toEqual([
      { schemeId: 'apiKey', scopes: [] },
      { schemeId: 'broker-security-1', scopes: [] },
    ]);
    expect(document.security).toEqual([
      { id: 'apiKey', type: 'apiKey', in: 'password' },
      {
        id: 'broker-security-1',
        type: 'userPassword',
        description: 'the broker credentials',
      },
    ]);
  });

  it('should resolve a derived id that collides with a declared name by a numeric suffix', () => {
    // Given a document that declares a scheme under the very name the position would derive
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Collision', version: '1.0.0' },
      servers: {
        broker: {
          host: 'broker.example.com',
          protocol: 'kafka',
          security: [{ type: 'plain' }],
        },
      },
      channels: { orders: { address: 'orders' } },
      operations: {},
      components: { securitySchemes: { 'broker-security-0': { type: 'gssapi' } } },
    });

    // When
    const [server] = document.servers;

    // Then both schemes exist and neither took the other's id, which is the resolution SPEC 8.2
    // already applies to two channels whose derived ids collide.
    expect(document.security.map((scheme) => `${scheme.id} ${scheme.type}`)).toEqual([
      'broker-security-0 gssapi',
      'broker-security-0-2 plain',
    ]);
    expect(server?.security).toEqual([{ schemeId: 'broker-security-0-2', scopes: [] }]);
  });

  it('should name one entry from two positions that reference one scheme', () => {
    // Given two servers referring to one declared scheme, which is the shape the ADEO corpus
    // document writes three times over
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Shared', version: '1.0.0' },
      servers: {
        production: {
          host: 'prod.example.com',
          protocol: 'kafka',
          security: [{ $ref: '#/components/securitySchemes/sasl' }],
        },
        staging: {
          host: 'staging.example.com',
          protocol: 'kafka',
          security: [{ $ref: '#/components/securitySchemes/sasl' }],
        },
      },
      channels: { orders: { address: 'orders' } },
      operations: {},
      components: { securitySchemes: { sasl: { type: 'plain' } } },
    });

    // When
    const schemeIds = document.servers.flatMap((server) =>
      (server.security ?? []).map((requirement) => requirement.schemeId),
    );

    // Then, and the document table holds it once: the position identifies the reference, and a
    // shared target does not become a second entry.
    expect(document.servers).toHaveLength(2);
    expect(schemeIds).toEqual(['sasl', 'sasl']);
    expect(document.security).toHaveLength(1);
  });

  it('should keep a written empty list apart from a member that was never written', () => {
    // Given one server that says there are none and one that says nothing
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Empty and absent', version: '1.0.0' },
      servers: {
        declared: { host: 'a.example.com', protocol: 'kafka', security: [] },
        silent: { host: 'b.example.com', protocol: 'kafka' },
      },
      channels: { orders: { address: 'orders' } },
      operations: {},
    });

    // When
    const [declared, silent] = document.servers;

    // Then, because AsyncAPI writes no sentence about an empty `security` at either position, so
    // "said there are none" is kept as what it is rather than folded into "said nothing".
    expect(declared?.security).toEqual([]);
    expect(silent?.security).toBeUndefined();
  });

  it('should read the security an operation trait declares, by the trait rule of SPEC 8.2', () => {
    // Given an operation whose only security comes from a trait
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'Trait security', version: '1.0.0' },
      channels: { orders: { address: 'orders' } },
      operations: {
        publish: {
          action: 'send',
          channel: { $ref: '#/channels/orders' },
          traits: [{ $ref: '#/components/operationTraits/secured' }],
        },
      },
      components: {
        operationTraits: { secured: { security: [{ $ref: '#/components/securitySchemes/sasl' }] } },
        securitySchemes: { sasl: { type: 'scramSha512' } },
      },
    });

    // When
    const channel = channelById(document, 'channel-orders');

    // Then, which is the same reading `events-corpus-fields.ts` performs on the input side: a
    // trait fills a member the target left out, so an operation whose security lives in a trait
    // is an operation with security.
    expect(operationOf(channel, 'publish').security).toEqual([{ schemeId: 'sasl', scopes: [] }]);
  });

  it('should leave both members absent on an HTTP document, where there is no such subject', () => {
    // Given, the OpenAPI side, whose Server Object declares no `security` member at all
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.1.0',
      info: { title: 'No security', version: '1.0.0' },
      servers: { broker: { host: 'broker.example.com', protocol: 'kafka' } },
      channels: { orders: { address: 'orders' } },
      operations: { publish: { action: 'send', channel: { $ref: '#/channels/orders' } } },
    });

    // When
    const channel = channelById(document, 'channel-orders');

    // Then
    expect(document.servers[0]?.security).toBeUndefined();
    expect(operationOf(channel, 'publish').security).toBeUndefined();
    expect(document.security).toEqual([]);
  });
});

describe('normalizeAsyncApiDocument the six members T048 had nowhere to hold', () => {
  it('should produce exactly these members for a channel, its operation and its message', () => {
    // Given, a document writing all six members `T048` named as unheld. Each is read off the
    // fixture first, because a pin over a produced node proves nothing about a member the fixture
    // stopped writing: it would report the member carried, or absent, by never having offered it.
    //
    // ALL SIX ARE NOW ASSERTED AS SURVIVALS RATHER THAN ABSENCES, and so is `channel.parameters`
    // since the ruling before `T049`. Four gained carriers at `T049` on the corpus's showing;
    // `server.security` and `operation.security` gained theirs at `T051`, which is where the
    // growth of `IRSecuritySchemeType` was ruled to belong. The pins below read every one of them
    // back off the produced node.
    const parts = droppedFieldsParts();
    const written = [
      ...Object.keys(parts.server).map((key) => `server.${key}`),
      ...Object.keys(parts.channel).map((key) => `channel.${key}`),
      ...Object.keys(parts.operation).map((key) => `operation.${key}`),
      ...Object.keys(parts.message).map((key) => `message.${key}`),
    ];
    expect(written).toEqual(
      expect.arrayContaining([
        'server.bindings',
        'server.security',
        'operation.reply',
        'operation.security',
        'operation.tags',
        'message.tags',
      ]),
    );
    expect(written).toContain('channel.parameters');

    // When
    const document = normalizeAsyncApiDocument(droppedFieldsDocument());
    const channel = channelById(document, 'channel-orders-tenant');
    const operation = operationOf(channel, 'publishOrderPlaced');
    const message = messageOf(channel, 'placed');

    // Then, exact equality on the whole of each produced node, which is what keeps both lists
    // recorded: a future IR field, or a member this normalizer stops carrying, breaks a pin here
    // instead of passing in silence. `IRServer` is pinned the same way beside the broker fixture.
    // The channel writes no `servers` block and the document declares one broker, so per SPEC 8.2
    // it is on that broker: this pin held `servers: []` until 2026-08-29, which said the opposite
    // to anyone reading the field on its own. `parameters` joined the pin the same day, and
    // `reply`, both `tags` and the server's `bindings` joined it at `T049`.
    expect(channel).toEqual({
      kind: 'channel',
      id: 'channel-orders-tenant',
      address: 'orders/{tenant}',
      tags: ['orders'],
      deprecated: false,
      protocol: 'kafka',
      parameters: { tenant: { enum: ['eu', 'us'], description: 'the tenant' } },
      servers: [{ url: 'kafka://kafka.example.com:9092' }],
      operations: [operation],
      messages: [message],
    });
    expect(operation).toEqual({
      id: 'publishOrderPlaced',
      direction: 'send',
      messageIds: ['placed'],
      reply: { channelId: 'channel-orders-tenant' },
      tags: ['internal'],
      security: [{ schemeId: 'sasl', scopes: [] }],
    });
    expect(message).toEqual({
      id: 'placed',
      name: 'OrderPlaced',
      payload: { kind: 'named', schemaId: 'Order' },
      tags: ['public'],
    });
    expect(document.servers).toEqual([
      {
        url: 'kafka://kafka.example.com:9092',
        protocol: 'kafka',
        bindings: { kafka: { schemaRegistryUrl: 'https://registry.example.com' } },
        security: [{ schemeId: 'sasl', scopes: [] }],
      },
    ]);
    // The scheme itself is written once, in the document's own table, and both positions name it.
    // `scramSha512` is one of the five types no corpus document writes, so this is also the one
    // place in the repository where that member of the grown union is produced from a document.
    expect(document.security).toEqual([{ id: 'sasl', type: 'scramSha512' }]);
  });

  it('should leave unreadKeys alone, because that field means an unread path item key', () => {
    // Given, the same document, whose two remaining unheld members are the loudest candidate
    // this side has for the record SPEC 7.1 keeps on the OpenAPI side
    const document = normalizeAsyncApiDocument(droppedFieldsDocument());

    // When
    const unread = document.unreadKeys;

    // Then, nothing, and per SPEC 8.2 that is a decision rather than an omission: `unreadKeys`
    // belongs to `operation-key-unread`, whose finding says an operation was written under a
    // path item key spelled in the wrong case. An AsyncAPI member filed there would print that
    // sentence about a channel's `parameters` block and count as a failed check.
    expect(unread).toBeUndefined();
  });
});

describe('normalizeAsyncApiDocument determinism', () => {
  it('should produce one hash from 200 shuffled spellings of one document', () => {
    // Given
    const random = createRandom(48);
    const base = JSON.stringify(createAsyncApi30());
    const expected = hashDocument(normalizeAsyncApiDocument(createAsyncApi30()));

    // When, each spelling is kept beside its hash rather than thrown away
    const spellings: string[] = [];
    const hashes = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const shuffled = shuffleKeys(createAsyncApi30(), random);
      spellings.push(JSON.stringify(shuffled));
      hashes.add(hashDocument(normalizeAsyncApiDocument(shuffled)));
    }

    // Then, the constructions differ before the hashes are compared. One hash out of 200 inputs
    // says nothing about ordering unless the 200 inputs were 200 different orderings, and a
    // `shuffleKeys` that had quietly become the identity would satisfy the equality below while
    // proving nothing at all.
    expect(spellings).toHaveLength(200);
    expect(new Set(spellings).size).toBe(200);
    expect(spellings.filter((spelling) => spelling === base)).toEqual([]);

    // and every one of those orderings normalizes to the one hash the document written by hand
    // produces
    expect(hashes.size).toBe(1);
    expect([...hashes][0]).toBe(expected);
  });
});

describe('the event types reserved in T002 needed no change to be filled', () => {
  it('should fill every reserved field that had no producer before this normalizer existed', () => {
    // Given, the five names the T047 declared field sweep found with no producer anywhere, all
    // of them on the three event types. The narrowing below is the compiler checking that the
    // values this normalizer builds are the types as `T002` declared them, with no cast.
    const document = normalizeAsyncApiDocument(createAsyncApi30());
    const channel: IRChannel = channelById(document, 'channel-orders-placed');
    const operation: IRChannelOperation = operationOf(channel, 'publishOrderPlaced');
    const message: IRMessage = messageOf(channel, 'orderPlaced');

    // When
    const filled = {
      channelBindings: channel.bindings,
      operationBindings: operation.bindings,
      operationMessageIds: operation.messageIds,
      messageBindings: message.bindings,
      messageCorrelationId: message.correlationId,
    };

    // Then
    expect(filled.channelBindings).toBeDefined();
    expect(filled.operationBindings).toBeDefined();
    expect(filled.operationMessageIds.length).toBeGreaterThan(0);
    expect(filled.messageBindings).toBeDefined();
    expect(filled.messageCorrelationId).toBeDefined();
  });

  it('should fill relationships from the actions the document declares, per SPEC 9.3', () => {
    // Given a document that declares no security scheme at all, so the empty `security` below is
    // the absence of a subject rather than a reading that was refused
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const read = { relationships: document.relationships, security: document.security };

    // Then, `relationships` was empty from `T048` until `T052`, and the mock's one `receive`
    // operation is now the one edge the document declares: the channel into this application, in
    // the direction the message travels. `security` was empty here for the other reason until
    // `T051`, which grew `IRSecuritySchemeType` to the fourteen names both specifications need.
    expect(read.relationships).toEqual([
      {
        from: 'channel-shipping-shipmentid-dispatched',
        fromKind: 'node',
        to: document.id,
        toKind: 'service',
        type: 'subscribes',
        confidence: 'declared',
      },
      {
        from: document.id,
        fromKind: 'service',
        to: 'channel-orders-placed',
        toKind: 'node',
        type: 'publishes',
        confidence: 'declared',
      },
    ]);
    expect(read.security).toEqual([]);
  });
});

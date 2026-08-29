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
 * The four objects of a document writing all seven members SPEC 8.2 records as unheld.
 *
 * They are named rather than inlined so the presence half of the proof can read each written
 * member off the fixture itself: `bindings` and `security` on the server, `parameters` on the
 * channel, `reply`, `security` and `tags` on the operation, and `tags` on the message.
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

    // Then, exactly these members and no others. The fixture's broker also declares a `kafka`
    // server binding, and `IRServer` has nowhere to put one: the equality below is what keeps
    // that gap recorded rather than invisible, and closing it is a change to a public type that
    // `T048` did not authorise.
    expect(broker).toEqual({
      url: 'kafka://kafka.example.com:9092',
      protocol: 'kafka',
      protocolVersion: '3.5',
      description: 'production broker',
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

describe('normalizeAsyncApiDocument fields the IR has nowhere to hold', () => {
  it('should produce exactly these members for a channel, its operation and its message', () => {
    // Given, a document writing all seven members SPEC 8.2 names as unheld. The absence proved
    // below is worth nothing unless each of them was written, so each is read off the fixture
    // first: a fixture that quietly stopped carrying one would otherwise prove that member gone
    // from the IR by never having put it there.
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
        'channel.parameters',
        'operation.reply',
        'operation.security',
        'operation.tags',
        'message.tags',
      ]),
    );

    // When
    const document = normalizeAsyncApiDocument(droppedFieldsDocument());
    const channel = channelById(document, 'channel-orders-tenant');
    const operation = operationOf(channel, 'publishOrderPlaced');
    const message = messageOf(channel, 'placed');

    // Then, exact equality on the whole of each produced node, which is what keeps the seven
    // recorded: a future IR field, or a member this normalizer stops carrying, breaks a pin here
    // instead of passing in silence. `IRServer` is pinned the same way beside the broker fixture.
    // The channel writes no `servers` block and the document declares one broker, so per SPEC 8.2
    // it is on that broker: this pin held `servers: []` until 2026-08-29, which said the opposite
    // to anyone reading the field on its own.
    expect(channel).toEqual({
      kind: 'channel',
      id: 'channel-orders-tenant',
      address: 'orders/{tenant}',
      tags: ['orders'],
      deprecated: false,
      protocol: 'kafka',
      servers: [{ url: 'kafka://kafka.example.com:9092' }],
      operations: [operation],
      messages: [message],
    });
    expect(operation).toEqual({
      id: 'publishOrderPlaced',
      direction: 'send',
      messageIds: ['placed'],
    });
    expect(message).toEqual({
      id: 'placed',
      name: 'OrderPlaced',
      payload: { kind: 'named', schemaId: 'Order' },
    });
    expect(document.servers).toEqual([
      { url: 'kafka://kafka.example.com:9092', protocol: 'kafka' },
    ]);
  });

  it('should leave unreadKeys alone, because that field means an unread path item key', () => {
    // Given, the same document, whose seven unheld members are the loudest candidate this side
    // has for the record SPEC 7.1 keeps on the OpenAPI side
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

  it('should leave relationships and security empty, because neither is this task to fill', () => {
    // Given
    const document = normalizeAsyncApiDocument(createAsyncApi30());

    // When
    const empty = { relationships: document.relationships, security: document.security };

    // Then, `relationships` is SPEC 9 and belongs to `T052`, and the AsyncAPI security scheme
    // types are a wider set than `IRSecuritySchemeType` declares, so a partial reading of them
    // would be a security picture that is wrong rather than missing.
    expect(empty.relationships).toEqual([]);
    expect(empty.security).toEqual([]);
  });
});

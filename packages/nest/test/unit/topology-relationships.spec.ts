import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Controller, Get } from '@nestjs/common';
import { MessagePattern, Transport } from '@nestjs/microservices';
import { normalizeAsyncApiDocument, normalizeOpenApiDocument } from '@openref/core';
import type { IRDocument, IRRelationship } from '@openref/core';
import { ApiChannel, ApiPublishes } from '../../src/api/decorators/api-decorators';
import { discoverChannels } from '../../src/events/infrastructure/adapters/channel-discovery.adapter';
import { synthesizeEventsDocument } from '../../src/events/domain/asyncapi-synthesis';
import { pairChannels } from '../../src/events/domain/channel-pairing';
import { runRuntimePass } from '../../src/runtime/application/services/runtime-pass.service';
import { declaredRelationships, withReadConfidence } from '../../src/runtime/domain/relationships';
import { metadataReflect } from '../../src/shared/types/nest-surface';
import type {
  DiscoveryServiceLike,
  InstanceWrapperLike,
  ModuleRefLike,
  ReflectorLike,
} from '../../src/shared/types/nest-surface';

/**
 * `@ApiPublishes` and the confidence of a synthesized direction, per SPEC 9.
 *
 * THE DECORATORS ARE THE REAL ONES AND SO IS THE REFLECTOR. What this proves is that a person
 * writing a decorator gets an edge and that a person writing nothing gets no edge, and a fake
 * reflector answering from a hand built map would prove that the map was read.
 *
 * THE SECOND HALF IS THE ONE WORTH HAVING. An events document is written by this package and read
 * back by the normalizer, so every direction comes out of that round trip saying `declared`. The
 * cases below hold the line SPEC 6.1 draws: what the framework's own decorator said is `derived`,
 * and only `@ApiChannel({ direction })` makes it `declared`.
 */

/** A reflector over the metadata the real decorators wrote, which is what Nest's own does. */
const reflector: ReflectorLike = {
  get: (key, target) => metadataReflect().getMetadata(key, target as object),
  getAllAndOverride: (key, targets) => {
    for (const target of targets) {
      const value: unknown = metadataReflect().getMetadata(key, target as object);
      if (value !== undefined) return value;
    }

    return undefined;
  },
};

const moduleRef: ModuleRefLike = { get: () => undefined };

function discoveryOf(
  controllers: readonly (new (...args: never[]) => unknown)[],
): DiscoveryServiceLike {
  const wrap = (metatype: new (...args: never[]) => unknown): InstanceWrapperLike => ({
    metatype,
    instance: new metatype(),
    name: metatype.name,
  });

  return { getControllers: () => controllers.map(wrap), getProviders: () => [] };
}

/** The document the HTTP controllers below serve: one operation, no edges of its own. */
function httpDocument(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Payments', version: '1.0.0' },
    paths: {
      '/payments': {
        get: { operationId: 'listPayments', responses: { '200': { description: 'ok' } } },
      },
    },
  });
}

/** The same document plus a webhook, so the normalizer has an edge of its own to leave alone. */
function httpDocumentWithWebhook(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Payments', version: '1.0.0' },
    paths: {
      '/payments': {
        get: { operationId: 'listPayments', responses: { '200': { description: 'ok' } } },
      },
    },
    webhooks: {
      settled: { post: { responses: { '200': { description: 'ok' } } } },
    },
  });
}

@Controller('payments')
class PublishingController {
  @Get()
  @ApiPublishes('payment.created')
  list(): string {
    return 'payments';
  }
}

@Controller('payments')
class TwoEventsController {
  @Get()
  @ApiPublishes('payment.created', 'payment.settled')
  list(): string {
    return 'payments';
  }
}

@Controller('payments')
class RepeatedEventController {
  @Get()
  @ApiPublishes('payment.created', 'payment.created')
  list(): string {
    return 'payments';
  }
}

@Controller('payments')
class EmptyPublishesController {
  @Get()
  @ApiPublishes()
  list(): string {
    return 'payments';
  }
}

/** What an application written in plain JavaScript reaches the decorator with. */
@Controller('payments')
class BadNameController {
  @Get()
  @ApiPublishes(...(['payment.created', 42, ''] as unknown as readonly string[]))
  list(): string {
    return 'payments';
  }
}

/** The declaration written once for every route of the class, which the reflector rule allows. */
@Controller('payments')
@ApiPublishes('payment.created')
class ClassLevelController {
  @Get()
  list(): string {
    return 'payments';
  }
}

@Controller('payments')
class SilentController {
  @Get()
  list(): string {
    return 'payments';
  }
}

/** A handler with nothing but the framework's own decorator: the direction is defaulted. */
@Controller()
class DerivedDirectionController {
  @MessagePattern('orders.created', Transport.KAFKA)
  created(): void {
    // nothing
  }
}

/** The same handler with the direction written down, which is the only thing that changes. */
@Controller()
class DeclaredDirectionController {
  @ApiChannel({ direction: 'receive' })
  @MessagePattern('orders.created', Transport.KAFKA)
  created(): void {
    // nothing
  }
}

/**
 * Runs the pass over the HTTP document and hands back what it produced.
 *
 * @param controller - The controller serving `GET /payments`
 * @param document - The document to augment, defaulting to the one with no edges
 * @returns The edges and the problems
 */
function passOver(
  controller: new (...args: never[]) => unknown,
  document: IRDocument = httpDocument(),
): {
  readonly relationships: readonly IRRelationship[];
  readonly problems: readonly { readonly subject: string; readonly reason: string }[];
  readonly nodeIds: readonly string[];
  readonly hash: string;
} {
  const result = runRuntimePass(document, {
    collectors: [],
    discovery: discoveryOf([controller]),
    reflector,
    moduleRef,
  });

  return {
    relationships: result.document.relationships,
    problems: result.discoveryProblems,
    nodeIds: [...result.document.nodes.keys()],
    hash: result.document.hash,
  };
}

/** Runs the whole events chain, which is where a direction is synthesized and read back. */
function eventsPass(controller: new (...args: never[]) => unknown): readonly IRRelationship[] {
  const discovered = discoverChannels(discoveryOf([controller]));
  const synthesized = synthesizeEventsDocument(discovered.channels, {
    title: 'Orders',
    version: 'runtime',
    servers: [{ protocol: 'kafka', host: 'kafka.example.com:9092' }],
  });
  const document = normalizeAsyncApiDocument(synthesized.document);
  const paired = pairChannels(document, synthesized.channels);

  const result = runRuntimePass(document, {
    collectors: [],
    discovery: discoveryOf([controller]),
    reflector,
    moduleRef,
    channelTargets: paired.targets,
    channelDirectionConfidence: paired.directionConfidence,
  });

  return result.document.relationships;
}

describe('@ApiPublishes', () => {
  it('should draw one declared edge from the handler node to the event it names', () => {
    // Given a controller whose one route declares one event

    // When
    const { relationships, nodeIds } = passOver(PublishingController);

    // Then the node is the operation the handler serves, and the event end is an `event` and not
    // a node id, because this document has no channel for it, per SPEC 9.1
    expect(nodeIds).toEqual(['get-payments']);
    expect(relationships).toEqual([
      {
        from: 'get-payments',
        fromKind: 'node',
        to: 'payment.created',
        toKind: 'event',
        type: 'publishes',
        confidence: 'declared',
      },
    ]);
  });

  it('should draw one edge per event name', () => {
    // Given a decorator with two names

    // When
    const { relationships } = passOver(TwoEventsController);

    // Then
    expect(relationships.map((edge) => edge.to)).toEqual(['payment.created', 'payment.settled']);
    expect(relationships.every((edge) => edge.confidence === 'declared')).toBe(true);
  });

  it('should fold a name written twice into one edge', () => {
    // Given a decorator that names the same event twice, which says one thing about the topology

    // When
    const { relationships } = passOver(RepeatedEventController);

    // Then
    expect(relationships).toHaveLength(1);
    expect(relationships[0]?.to).toBe('payment.created');
  });

  it('should report a decorator that names nothing and draw no edge for it', () => {
    // Given

    // When
    const { relationships, problems, nodeIds } = passOver(EmptyPublishesController);

    // Then the handler was discovered and paired, so the missing edge is a refusal rather than a
    // handler nothing reached
    expect(nodeIds).toEqual(['get-payments']);
    expect(relationships).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.subject).toBe('EmptyPublishesController.list');
    expect(problems[0]?.reason).toContain('no event name');
  });

  it('should report an entry that is not an event name and still draw the ones that are', () => {
    // Given a decorator holding one usable name, a number and an empty string

    // When
    const { relationships, problems } = passOver(BadNameController);

    // Then the usable name is drawn, which is what makes this a report rather than a refusal of
    // the whole decorator
    expect(relationships.map((edge) => edge.to)).toEqual(['payment.created']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.subject).toBe('BadNameController.list');
    expect(problems[0]?.reason).toContain('non-empty event name');
  });

  it('should read the declaration off the class when the method carries none', () => {
    // Given the decorator on the controller rather than on the route

    // When
    const { relationships } = passOver(ClassLevelController);

    // Then
    expect(relationships).toEqual([
      {
        from: 'get-payments',
        fromKind: 'node',
        to: 'payment.created',
        toKind: 'event',
        type: 'publishes',
        confidence: 'declared',
      },
    ]);
  });

  it('should leave the normalizer edges exactly as they were when nothing declares anything', () => {
    // Given a document that carries an edge of its own, so this is not two empty lists agreeing
    const document = httpDocumentWithWebhook();
    expect(document.relationships).toEqual([
      {
        from: 'payments',
        fromKind: 'service',
        to: 'webhook-post-settled',
        toKind: 'node',
        type: 'webhook',
        confidence: 'declared',
      },
    ]);

    // When
    const { relationships } = passOver(SilentController, document);

    // Then
    expect(relationships).toEqual(document.relationships);
  });

  it('should cover the edges with the document hash, because the cache is keyed by it', () => {
    // Given two runs over one document, differing only in the event a decorator names

    // When
    const named = passOver(PublishingController);
    const other = passOver(TwoEventsController);

    // Then, with both asserted to have drawn something, so this is not two failures matching
    expect(named.relationships.length).toBeGreaterThan(0);
    expect(other.relationships.length).toBeGreaterThan(0);
    expect(named.hash).not.toBe(other.hash);
  });
});

describe('the confidence of a synthesized direction, per SPEC 9.3', () => {
  it('should mark a direction the framework decorator implied as derived', () => {
    // Given a `@MessagePattern` handler and nothing else: the `receive` action was defaulted by
    // this package rather than written by a person

    // When
    const relationships = eventsPass(DerivedDirectionController);

    // Then, and the edge itself is asserted present, so `derived` is a reading and not an absence
    expect(relationships).toEqual([
      {
        from: 'channel-orders-created',
        fromKind: 'node',
        to: 'orders',
        toKind: 'service',
        type: 'subscribes',
        confidence: 'derived',
      },
    ]);
  });

  it('should mark the same direction as declared when a person wrote it', () => {
    // Given the identical handler with `@ApiChannel({ direction: 'receive' })` added

    // When
    const relationships = eventsPass(DeclaredDirectionController);

    // Then the only difference from the case above is the word, which is the point of the pair
    expect(relationships).toEqual([
      {
        from: 'channel-orders-created',
        fromKind: 'node',
        to: 'orders',
        toKind: 'service',
        type: 'subscribes',
        confidence: 'declared',
      },
    ]);
  });
});

describe('declaredRelationships', () => {
  it('should report metadata that is not a list at all and draw nothing for it', () => {
    // Given the key written by hand rather than by the decorator, which is the only way this
    // shape is reachable: the decorator's own rest parameter is always an array
    const target = {
      node: { kind: 'operation', id: 'get-payments' },
      controller: { name: 'HandWrittenController' },
      declaredOn: { name: 'HandWrittenController' },
      handler: () => undefined,
      handlerName: 'list',
    } as unknown as Parameters<typeof declaredRelationships>[0][number];

    // When
    const read = declaredRelationships([target], {
      get: () => undefined,
      getAllAndOverride: () => 'payment.created',
    });

    // Then
    expect(read.edges).toEqual([]);
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]?.subject).toBe('HandWrittenController.list');
    expect(read.problems[0]?.reason).toContain('other than a list of event names');
  });
});

describe('withReadConfidence', () => {
  const document = (relationships: readonly IRRelationship[]): IRDocument =>
    ({
      id: 'orders',
      kind: 'events',
      hash: '',
      info: { title: 'Orders', version: 'runtime' },
      servers: [],
      navigation: [],
      nodes: new Map(),
      schemas: new Map(),
      security: [],
      relationships,
      webhooks: new Map(),
    }) satisfies IRDocument;

  const edge = (confidence: IRRelationship['confidence']): IRRelationship => ({
    from: 'channel-orders',
    fromKind: 'node',
    to: 'orders',
    toKind: 'service',
    type: 'subscribes',
    confidence,
  });

  it('should lower a declared edge to the level the direction was actually read at', () => {
    // Given

    // When
    const lowered = withReadConfidence(
      document([edge('declared')]),
      new Map([['channel-orders', 'derived']]),
    );

    // Then
    expect(lowered[0]?.confidence).toBe('derived');
  });

  it('should never raise an edge that is already weaker than the reading', () => {
    // Given an edge at `inferred` and a map saying the direction was declared

    // When
    const kept = withReadConfidence(
      document([edge('inferred')]),
      new Map([['channel-orders', 'declared']]),
    );

    // Then the weaker of the two survives, because this function exists to take a word back and
    // never to hand a stronger one out
    expect(kept[0]?.confidence).toBe('inferred');
  });

  it('should leave an edge whose node end the map does not name', () => {
    // Given a map about a different channel

    // When
    const kept = withReadConfidence(
      document([edge('declared')]),
      new Map([['channel-billing', 'derived']]),
    );

    // Then
    expect(kept[0]?.confidence).toBe('declared');
  });

  it('should find the node end of a publishes edge, which carries it second', () => {
    // Given the shape a `send` operation produces: the service publishes into the channel, so the
    // channel is the `to` end rather than the `from` end
    const send: IRRelationship = {
      from: 'orders',
      fromKind: 'service',
      to: 'channel-orders',
      toKind: 'node',
      type: 'publishes',
      confidence: 'declared',
    };

    // When
    const lowered = withReadConfidence(document([send]), new Map([['channel-orders', 'derived']]));

    // Then
    expect(lowered[0]?.confidence).toBe('derived');
  });

  it('should leave an edge with no node end at all, because no channel is named in it', () => {
    // Given a `publishes` edge between a service and an event name, which names no channel of
    // this document and therefore nothing the map could be about
    const detached: IRRelationship = {
      from: 'orders',
      fromKind: 'service',
      to: 'orders.created',
      toKind: 'event',
      type: 'publishes',
      confidence: 'declared',
    };

    // When
    const kept = withReadConfidence(document([detached]), new Map([['channel-orders', 'derived']]));

    // Then
    expect(kept).toEqual([detached]);
  });

  it('should leave a calls edge alone, because no action produced it', () => {
    // Given a request-reply pair, whose edge comes from `reply.channel` and not from an action
    const calls: IRRelationship = {
      from: 'channel-orders',
      fromKind: 'node',
      to: 'channel-orders-reply',
      toKind: 'node',
      type: 'calls',
      confidence: 'declared',
    };

    // When
    const kept = withReadConfidence(document([calls]), new Map([['channel-orders', 'derived']]));

    // Then
    expect(kept).toEqual([calls]);
  });
});

import { describe, expect, it } from 'vitest';
import { Controller, Injectable } from '@nestjs/common';
import { EventPattern, MessagePattern, Transport } from '@nestjs/microservices';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { hashDocument, normalizeAsyncApiDocument } from '@openref/core';
import { discoverChannels } from '../../src/events/infrastructure/adapters/channel-discovery.adapter';
import { synthesizeEventsDocument } from '../../src/events/domain/asyncapi-synthesis';
import type {
  DiscoveryServiceLike,
  InstanceWrapperLike,
} from '../../src/shared/types/nest-surface';

/**
 * The M5 adversarial pass over the event discovery of `@openref/nest`, per `T054`.
 *
 * WHAT AN ATTACK ON THIS SURFACE LOOKS LIKE. The discovery reads a container at one moment and
 * writes a document that is then cached by hash, so the interesting inputs are the ones that
 * change under it: a provider registered after the document was built, a transport that is one
 * value at boot and another at generation, and two handlers crafted to collide on an address. Each
 * block says what it drove and what came back.
 */

function discoveryOf(
  controllers: readonly (new (...args: never[]) => unknown)[],
  providers: readonly (new (...args: never[]) => unknown)[] = [],
): DiscoveryServiceLike {
  const wrap = (metatype: new (...args: never[]) => unknown): InstanceWrapperLike => ({
    metatype,
    instance: new metatype(),
    name: metatype.name,
  });

  return {
    getControllers: () => controllers.map(wrap),
    getProviders: () => providers.map(wrap),
  };
}

function synthesize(discovery: DiscoveryServiceLike): {
  readonly document: Record<string, unknown>;
  readonly problems: readonly { readonly subject: string; readonly reason: string }[];
} {
  const found = discoverChannels(discovery);
  const built = synthesizeEventsDocument(found.channels, { title: 'App', version: '1' });
  return { document: built.document, problems: [...found.problems, ...built.problems] };
}

@Controller()
class OrdersController {
  @MessagePattern('orders.get', Transport.KAFKA)
  get(): string {
    return 'one';
  }
}

@Injectable()
@WebSocketGateway({ path: '/socket.io', namespace: '/chat' })
class ChatGateway {
  @SubscribeMessage('message')
  onMessage(): void {
    // nothing
  }
}

describe('a gateway registered after the document was generated', () => {
  it('should be absent from the document that was generated, and present in the next one', () => {
    // Given a container that reports one controller, and the same container after a gateway
    // provider joins it. SPEC 13.2's `documents` form builds at `onModuleInit` and the render is
    // cached by document hash, so what a late arrival must never do is change a served document
    // without changing its hash.
    let providers: (new (...args: never[]) => unknown)[] = [];
    const discovery: DiscoveryServiceLike = {
      getControllers: () => [
        { metatype: OrdersController, instance: new OrdersController(), name: 'OrdersController' },
      ],
      getProviders: () =>
        providers.map((metatype) => ({ metatype, instance: new metatype(), name: metatype.name })),
    };

    // When the document is built, then the gateway arrives, then a second document is built
    const before = synthesize(discovery);
    providers = [ChatGateway];
    const after = synthesize(discovery);

    // Then the first document does not describe the gateway, the second does, and the two hash
    // differently, which is what says the cache key moves with the content rather than a reader
    // being served a stale page under a key that still matches. Nothing is silently mutated: the
    // first document is a value and a later registration cannot reach into it.
    const addresses = (document: Record<string, unknown>): string[] =>
      Object.values((document.channels ?? {}) as Record<string, { address?: string }>)
        .map((channel) => channel.address ?? '')
        .sort();

    expect(addresses(before.document)).toEqual(['orders.get']);
    expect(addresses(after.document)).toEqual(['/socket.io/chat', 'orders.get']);
    expect(hashDocument(normalizeAsyncApiDocument(before.document))).not.toBe(
      hashDocument(normalizeAsyncApiDocument(after.document)),
    );
  });
});

describe('a microservice configuration that changes transport between boot and generation', () => {
  it('should follow the decorator and not a connection, because it reads only the decorator', () => {
    // Given two classes that differ only in the transport their decorator names. SPEC 8.3 records
    // that the transport is read from the decorator's second argument and that
    // `app.connectMicroservice` writes nothing this package can reach, so a host that reconnects a
    // different transport between boot and generation changes nothing here. That is the claim, and
    // this case is what turns it from a sentence into a measurement.
    @Controller()
    class AtBoot {
      @EventPattern('orders.created', Transport.KAFKA)
      created(): void {
        // nothing
      }
    }

    @Controller()
    class AtGeneration {
      @EventPattern('orders.created', Transport.RMQ)
      created(): void {
        // nothing
      }
    }

    // When
    const boot = synthesize(discoveryOf([AtBoot]));
    const generation = synthesize(discoveryOf([AtGeneration]));

    const protocols = (document: Record<string, unknown>): string[] =>
      Object.values((document.servers ?? {}) as Record<string, { protocol?: string }>)
        .map((server) => server.protocol ?? '')
        .sort();

    // Then each document names the protocol its own decorator named, and neither invents one from
    // a connection. A host that changed the transport in code and not in the decorator gets the
    // decorator's answer, which is the honest one: the decorator is what routes the message.
    expect(protocols(boot.document)).toEqual(['kafka']);
    expect(protocols(generation.document)).toEqual(['amqp']);
    // And the only problem either run reports is the one SPEC 8.3 owes for a protocol whose host
    // nobody configured, which is a fact about this fixture passing no servers rather than about
    // the transport reading. Naming it is what keeps the two assertions above from being read as
    // "nothing went wrong at all".
    expect(boot.problems.map((problem) => problem.subject)).toEqual(['the kafka broker']);
    expect(generation.problems.map((problem) => problem.subject)).toEqual(['the amqp broker']);
  });

  it('should report a transport outside the table rather than invent a protocol for it', () => {
    // Given a handler naming a transport number no version of the enum carries, which is what a
    // custom transport strategy produces and what a hostile decorator argument looks like
    @Controller()
    class CustomStrategy {
      @EventPattern('orders.created', 9999 as unknown as Transport)
      created(): void {
        // nothing
      }
    }

    // When
    const { document, problems } = synthesize(discoveryOf([CustomStrategy]));

    // Then the channel exists, no server is invented for it, and the problem names the number.
    // The channel is asserted present first, so "no protocol" is a fact about a channel that is
    // really there rather than about a document that produced nothing.
    const channels = (document.channels ?? {}) as Record<
      string,
      { address?: string; servers?: unknown }
    >;
    expect(Object.values(channels).map((channel) => channel.address)).toEqual(['orders.created']);
    expect(document.servers ?? {}).toEqual({});
    expect(problems.filter((problem) => problem.reason.includes('9999'))).toHaveLength(1);
  });
});

describe('two handlers crafted to collide', () => {
  it('should give one channel to one address however many handlers answer it', () => {
    // Given two controllers whose patterns are the same address in two transports, which SPEC 8.3
    // says is one channel on two brokers rather than two channels of one address
    @Controller()
    class Kafka {
      @EventPattern('orders.created', Transport.KAFKA)
      created(): void {
        // nothing
      }
    }

    @Controller()
    class Rabbit {
      @EventPattern('orders.created', Transport.RMQ)
      created(): void {
        // nothing
      }
    }

    // When
    const { document } = synthesize(discoveryOf([Kafka, Rabbit]));
    const channels = (document.channels ?? {}) as Record<string, { address?: string }>;

    // Then one channel, and the document normalizes, which is the half that says the synthesized
    // key survived the collision the document key allocator has to resolve
    expect(Object.keys(channels)).toHaveLength(1);
    expect(normalizeAsyncApiDocument(document).nodes.size).toBe(1);
  });

  it('should produce one document whatever order the container reports the classes in', () => {
    // Given the same two classes reported in both orders. The container's walk order is not
    // something anybody controls, and a document that depends on it is a document that changes
    // under a reader for no reason.
    @Controller()
    class First {
      @EventPattern('a.one', Transport.KAFKA)
      one(): void {
        // nothing
      }
    }

    @Controller()
    class Second {
      @EventPattern('a.two', Transport.RMQ)
      two(): void {
        // nothing
      }
    }

    // When
    const forwards = synthesize(discoveryOf([First, Second]));
    const backwards = synthesize(discoveryOf([Second, First]));

    // Then one hash. The two inputs are asserted distinct first, so a comparison of one thing with
    // itself cannot pass this.
    expect([Second, First]).not.toEqual([First, Second]);
    expect(hashDocument(normalizeAsyncApiDocument(backwards.document))).toBe(
      hashDocument(normalizeAsyncApiDocument(forwards.document)),
    );
  });

  it('should keep a pattern that spells an existing document key out of that key', () => {
    // Given one handler on a plain address and another whose address, once made safe to file
    // under, is the key the first one took. `documentKey` replaces everything outside a safe set,
    // so `orders/created` and `orders-created` both want `orders-created`.
    @Controller()
    class Slashed {
      @EventPattern('orders/created', Transport.KAFKA)
      slashed(): void {
        // nothing
      }
    }

    @Controller()
    class Hyphened {
      @EventPattern('orders-created', Transport.KAFKA)
      hyphened(): void {
        // nothing
      }
    }

    // When
    const { document } = synthesize(discoveryOf([Slashed, Hyphened]));
    const channels = (document.channels ?? {}) as Record<string, { address?: string }>;

    // Then two keys, two channels, two addresses, and each address is the one its handler wrote.
    // A collision resolved by overwriting would show one of the two addresses twice or lose one.
    expect(Object.keys(channels)).toHaveLength(2);
    expect(
      Object.values(channels)
        .map((channel) => channel.address)
        .sort(),
    ).toEqual(['orders-created', 'orders/created']);
    expect(normalizeAsyncApiDocument(document).nodes.size).toBe(2);
  });
});

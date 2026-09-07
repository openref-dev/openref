import { describe, expect, it } from 'vitest';
import { Controller, Injectable } from '@nestjs/common';
import { EventPattern, MessagePattern, Transport } from '@nestjs/microservices';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Subscribe } from '@nestjs-redisx/pubsub';
import { StreamConsumer } from '@nestjs-redisx/streams';
import { transformPatternToRoute } from '@nestjs/microservices/utils';
import type { MsPattern } from '@nestjs/microservices';
import type { IRChannel } from '@openref/core';
import { normalizeAsyncApiDocument } from '@openref/core';
import { ApiChannel, ApiMessage } from '../../src/api/decorators/api-decorators';
import { discoverChannels } from '../../src/events/infrastructure/adapters/channel-discovery.adapter';
import {
  bySeniority,
  declaredValue,
  derived,
  patternAddress,
} from '../../src/events/domain/event-metadata';
import { synthesizeEventsDocument } from '../../src/events/domain/asyncapi-synthesis';
import { pairChannels } from '../../src/events/domain/channel-pairing';
import { NEST_TRANSPORT_NAMES } from '../../src/shared/types/nest-surface';
import type {
  DiscoveryServiceLike,
  InstanceWrapperLike,
} from '../../src/shared/types/nest-surface';

/**
 * The event collectors of SPEC 8.3, from the container to a normalized channel.
 *
 * THE WHOLE CHAIN IS EXERCISED HERE AND NOT ONLY ITS ENDS. What `T051` promises is that events
 * appear in the documentation without anybody writing an AsyncAPI file, and the only proof of that
 * is the one that starts at a decorated class and finishes at an `IRChannel`: the discovery, the
 * synthesis, the normalizer of `T048` and the pairing that gives a channel its runtime facts.
 *
 * THE DECORATORS ARE THE REAL ONES. `@MessagePattern`, `@EventPattern`, `@WebSocketGateway` and
 * `@SubscribeMessage` come from the packages that write the metadata, so a key this package reads
 * that the framework stops writing breaks these cases as well as `nest-value-surface.spec.ts`.
 */

/** A `DiscoveryService` over classes this file declares, which is what the walk is given. */
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

@Controller()
class KafkaOrdersController {
  @MessagePattern('orders.get', Transport.KAFKA)
  get(): string {
    return 'one order';
  }

  @EventPattern('orders.created', Transport.KAFKA)
  created(): void {
    // nothing
  }
}

@Controller()
class RabbitBillingController {
  @EventPattern('billing.settled', Transport.RMQ)
  settled(): void {
    // nothing
  }
}

@Controller()
class UntransportedController {
  @MessagePattern({ cmd: 'sum' })
  sum(): number {
    return 0;
  }
}

@Injectable()
@WebSocketGateway(8080, { namespace: 'chat', path: '/ws' })
class ChatGateway {
  @SubscribeMessage('events')
  events(): void {
    // nothing
  }

  @SubscribeMessage('typing')
  typing(): void {
    // nothing
  }
}

@Injectable()
@WebSocketGateway()
class SilentGateway {
  push(): void {
    // nothing
  }
}

/**
 * The two findings of SPEC 8.3 that the discovery builds and nothing exercised until now.
 *
 * THE CASTS ARE THE POINT AND NOT A CONVENIENCE. `MsPattern` admits a string, a number and an
 * object, and `Transport` admits the seven numbers the enum names, so neither of these two states
 * is reachable through the decorator's own types. They are reachable in a JavaScript host, and
 * through a custom transport strategy, which is exactly what SPEC 8.3 says the second finding is
 * for. What is measured here is that the reader reports rather than inventing an address or a
 * protocol, which is the rule the whole walk is written to.
 */
@Controller()
class UnreadableController {
  @MessagePattern(true as never)
  neither(): void {
    // nothing
  }

  @MessagePattern('custom.thing', 99 as never)
  strange(): void {
    // nothing
  }
}

/** Two handlers on one address writing two different channel titles, which is SPEC 8.3's rule. */
@Controller()
class DisagreeingController {
  @ApiChannel({ title: 'Orders, from the writer' })
  @EventPattern('orders.audited')
  wrote(): void {
    // nothing
  }

  @ApiChannel({ title: 'Orders, from the auditor' })
  @EventPattern('orders.audited')
  audited(): void {
    // nothing
  }
}

/** Two handlers on one address writing the same title, which is not a disagreement. */
@Controller()
class AgreeingController {
  @ApiChannel({ title: 'One title', tags: ['orders', 'audit'] })
  @EventPattern('orders.agreed')
  first(): void {
    // nothing
  }

  @ApiChannel({ title: 'One title', tags: ['orders', 'audit'] })
  @EventPattern('orders.agreed')
  second(): void {
    // nothing
  }
}

class OrderPlacedDto {
  id = '';
}

/** A class no schema table in this file answers to, which is the level 4 case of SPEC 13.6. */
class UndescribedDto {
  id = '';
}

@Controller()
class DeclaredController {
  @ApiChannel({ address: 'orders.placed', protocol: 'amqp', summary: 'An order was placed' })
  @ApiMessage({ payload: OrderPlacedDto, contentType: 'application/json' })
  placed(): void {
    // nothing
  }

  @ApiChannel({ protocol: 'mqtt' })
  @MessagePattern('sensors.reading', Transport.KAFKA)
  reading(): void {
    // nothing
  }

  @ApiMessage({ payload: { type: 'object', properties: { id: { type: 'string' } } } })
  @EventPattern('orders.shipped')
  shipped(): void {
    // nothing
  }

  @ApiMessage({ payload: UndescribedDto })
  @EventPattern('orders.unknown')
  unknown(): void {
    // nothing
  }
}

/**
 * A plain provider carrying `@ApiChannel`, which is SPEC 8.3's third class kind.
 *
 * IT IS NEITHER A CONTROLLER NOR A GATEWAY, and that is the whole of what this fixture is for. A
 * projector, a saga, a listener a broker library registers: none of them is a `@Controller` and
 * none implies `@WebSocketGateway`, and until 2026-09-04 the walk read `@ApiChannel` on those two
 * class kinds alone, so the decorator written here reached nothing at all.
 */
@Injectable()
class OrdersProjector {
  @ApiChannel({ address: 'orders.projected', protocol: 'kafka', summary: 'An order was projected' })
  @ApiMessage({ payload: OrderPlacedDto })
  onProjected(): void {
    // nothing
  }
}

/**
 * A plain provider carrying a framework pattern and no `@ApiChannel`, which is not a channel.
 *
 * THE NARROWING IS THE DECISION AND NOT AN OVERSIGHT. Nest routes `@MessagePattern` off a
 * controller; a provider carrying one is served by nothing, so a walk that admitted it would put an
 * address in the reference that no message ever arrives at. What the provider walk admits is the
 * declaration, because a declaration is a person stating a fact rather than the framework being
 * read off a class the framework does not route.
 */
@Injectable()
class PatternedProvider {
  @MessagePattern('providers.unrouted', Transport.KAFKA)
  unrouted(): void {
    // nothing
  }
}

function channelsOf(document: unknown): IRChannel[] {
  const normalized = normalizeAsyncApiDocument(document);
  return [...normalized.nodes.values()].filter(
    (node): node is IRChannel => node.kind === 'channel',
  );
}

describe('discoverChannels, per SPEC 8.3', () => {
  it('should read a message pattern and an event pattern off the same controller', () => {
    // Given
    const discovery = discoveryOf([KafkaOrdersController]);

    // When
    const { channels } = discoverChannels(discovery);

    // Then, both sources, both addresses, and the transport at `derived` on each: a transport
    // read from framework metadata is never `declared`, per SPEC 8.3 and the `T019` discipline
    expect(channels.map((channel) => `${channel.source} ${channel.address.value}`).sort()).toEqual([
      'event-pattern orders.created',
      'message-pattern orders.get',
    ]);
    expect(channels.map((channel) => channel.transport?.confidence)).toEqual([
      'derived',
      'derived',
    ]);
    expect(channels.map((channel) => channel.transport?.value.protocol)).toEqual([
      'kafka',
      'kafka',
    ]);
  });

  it('should render a pattern written as an object the way the framework routes it', () => {
    // Given the shape `String(pattern)` turns into `[object Object]` for every such handler
    const discovery = discoveryOf([UntransportedController]);

    // When
    const { channels } = discoverChannels(discovery);

    // Then it is handled rather than stringified, and the address is compared with the
    // framework's own route transform rather than with a spelling this file also wrote
    expect(channels).toHaveLength(1);
    expect(channels[0]?.address.value).not.toContain('object Object');
    expect(channels[0]?.address.value).toBe(transformPatternToRoute({ cmd: 'sum' }));
  });

  it('should agree with the framework route transform over a matrix of patterns', () => {
    // Given the shapes a pattern is written in
    const patterns: readonly MsPattern[] = [
      'orders.created',
      42,
      { cmd: 'sum' },
      { cmd: 'sum', role: 'admin' },
      { role: 'admin', cmd: 'sum' },
    ];

    // When
    const disagreeing = patterns.filter(
      (pattern) => patternAddress(pattern)?.address !== transformPatternToRoute(pattern),
    );

    // Then, and the two orderings of one object agree with each other as well, which is what
    // makes the address deterministic rather than dependent on how the decorator was typed
    expect(disagreeing).toEqual([]);
    expect(patternAddress({ cmd: 'sum', role: 'admin' })?.address).toBe(
      patternAddress({ role: 'admin', cmd: 'sum' })?.address,
    );
  });

  it('should resolve a gateway namespace and path into one channel address', () => {
    // Given a gateway declaring both halves, which is the case a reader cannot reach with one
    const discovery = discoveryOf([], [ChatGateway]);

    // When
    const { channels } = discoverChannels(discovery);

    // Then both `@SubscribeMessage` methods are on one address, because a socket.io gateway is
    // one connection that many events travel over, and the protocol is `ws` at `derived`
    expect(channels.map((channel) => channel.address.value)).toEqual(['/ws/chat', '/ws/chat']);
    expect(channels.map((channel) => channel.protocol?.value)).toEqual(['ws', 'ws']);
    expect(channels.map((channel) => channel.protocol?.confidence)).toEqual(['derived', 'derived']);
    expect(channels.map((channel) => channel.handlerName).sort()).toEqual(['events', 'typing']);
  });

  it('should report a gateway with no subscribe message rather than inventing a channel', () => {
    // Given a gateway that only pushes
    const discovery = discoveryOf([], [SilentGateway]);

    // When
    const { channels, problems } = discoverChannels(discovery);

    // Then nothing was produced and the reason is a finding rather than silence
    expect(channels).toEqual([]);
    expect(problems.map((problem) => problem.subject)).toEqual(['SilentGateway']);
    expect(problems[0]?.reason).toContain('@SubscribeMessage');
  });

  it('should report a pattern no address can be made from rather than rendering what it is', () => {
    // Given a handler whose pattern is neither a string, a number nor an object. The controller
    // carries a second, readable handler, so the absence below is a rejection of one pattern
    // rather than a controller the walk never reached.
    const discovery = discoveryOf([UnreadableController]);

    // When
    const { channels, problems } = discoverChannels(discovery);
    const found = problems.filter((problem) => problem.subject === 'UnreadableController.neither');

    // Then no channel of an invented address, and the finding SPEC 8.3 promises, naming the class
    // and the method so a reader knows which handler to look at
    expect(channels.map((channel) => channel.address.value)).toEqual(['custom.thing']);
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain('1 of its patterns are neither a string');
  });

  it('should report a transport number outside the table rather than inventing a protocol', () => {
    // Given the same controller, whose second handler names transport 99. The table is asserted
    // not to hold it first, so this is a number outside the table rather than a number the table
    // stopped holding.
    expect(NEST_TRANSPORT_NAMES[99]).toBeUndefined();
    const discovery = discoveryOf([UnreadableController]);

    // When
    const { channels, problems } = discoverChannels(discovery);
    const strange = channels.find((channel) => channel.address.value === 'custom.thing');
    const found = problems.filter((problem) => problem.subject === 'UnreadableController.strange');

    // Then the channel exists with no transport and therefore no protocol, and the reason is a
    // finding: a custom transport strategy carries a number of its author's choosing, and naming
    // a protocol for it would describe a broker nobody declared
    expect(strange?.transport).toBeUndefined();
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain('it names transport 99');
  });

  it('should let a declared channel outrank the metadata it stands beside', () => {
    // Given a handler carrying both `@MessagePattern(..., KAFKA)` and `@ApiChannel({ protocol })`
    const discovery = discoveryOf([DeclaredController]);

    // When
    const { channels } = discoverChannels(discovery);
    const reading = channels.find((channel) => channel.address.value === 'sensors.reading');

    // Then the framework metadata is still read, and the declared protocol is what the document
    // will carry, per SPEC 6.1: a person writing it down is documenting the endpoint
    expect(reading?.transport?.value.protocol).toBe('kafka');
    expect(reading?.declared?.value.protocol).toBe('mqtt');
    expect(reading?.declared?.confidence).toBe('declared');
  });

  it('should produce a channel from a declaration alone, with no framework pattern at all', () => {
    // Given a handler that carries only this package's own decorators
    const discovery = discoveryOf([DeclaredController]);

    // When
    const { channels } = discoverChannels(discovery);
    const placed = channels.find((channel) => channel.address.value === 'orders.placed');

    // Then, and the address is `declared` rather than `derived`, because nothing framework
    // shaped produced it
    expect(placed?.address.confidence).toBe('declared');
    expect(placed?.declared?.value.summary).toBe('An order was placed');
    // And the source names the decorator that produced it rather than one of the two framework
    // ones. It read `message-pattern` until 2026-09-04, which said a decorator nobody wrote here
    // had been read off this handler.
    expect(placed?.source).toBe('api-channel');
  });

  it('should read a declaration off a plain provider, which is neither controller nor gateway', () => {
    // Given a provider that is only `@Injectable()`, reported where a gateway would be reported
    const discovery = discoveryOf([], [OrdersProjector]);
    expect(discovery.getProviders().map((wrapper) => wrapper.name)).toEqual(['OrdersProjector']);

    // When
    const { channels, problems } = discoverChannels(discovery);

    // Then the third class kind of SPEC 8.3 reaches the walk, at `declared`, with its message
    expect(channels.map((channel) => channel.address.value)).toEqual(['orders.projected']);
    expect(channels[0]?.address.confidence).toBe('declared');
    expect(channels[0]?.source).toBe('api-channel');
    expect(channels[0]?.declared?.value.summary).toBe('An order was projected');
    expect(channels[0]?.message?.value.payload).toBe(OrderPlacedDto);
    expect(problems).toEqual([]);
  });

  it('should not read a framework pattern off a provider, which the framework does not route', () => {
    // Given a provider carrying `@MessagePattern`, which is asserted to be really there before
    // its absence from the result is claimed to mean anything
    const discovery = discoveryOf([], [PatternedProvider]);
    const unrouted: unknown = Object.getOwnPropertyDescriptor(
      PatternedProvider.prototype,
      'unrouted',
    )?.value;
    expect(Reflect.getMetadata('microservices:pattern', unrouted as object)).toBeDefined();

    // When
    const { channels, problems } = discoverChannels(discovery);

    // Then nothing, because Nest routes that decorator off a controller and a channel here would
    // be an address in the reference no message ever arrives at
    expect(channels).toEqual([]);
    expect(problems).toEqual([]);
  });

  it('should read a declaration off a class that is a controller and one that is a provider alike', () => {
    // Given both class kinds at once, so the two walks are proved not to drop or double either
    const discovery = discoveryOf([DeclaredController], [OrdersProjector, SilentGateway]);

    // When
    const { channels } = discoverChannels(discovery);

    // Then one entry per declaration and no entry twice
    expect(channels.filter((channel) => channel.address.value === 'orders.projected')).toHaveLength(
      1,
    );
    expect(channels.filter((channel) => channel.address.value === 'orders.placed')).toHaveLength(1);
  });
});

describe('bySeniority, per SPEC 6.1 and SPEC 8.3', () => {
  it('should let the level decide and not the order the candidates were looked for in', () => {
    // Given one member named twice, at two levels, written in both orders
    const declared = declaredValue('mqtt');
    const framework = derived('kafka');

    // When
    const declaredFirst = bySeniority([declared, framework]);
    const derivedFirst = bySeniority([framework, declared]);

    // Then both answer the same, which is what makes SPEC 8.3's seniority sentence a statement
    // about the values rather than about the order a chain of `??` happens to be written in
    expect(declaredFirst).toEqual(declared);
    expect(derivedFirst).toEqual(declared);
  });

  it('should take the first of several derived candidates and nothing at all from none', () => {
    // Given, and the absent candidates are present in the list, because that is how the readers
    // hand it over: one entry per place a member could have been named
    const first = derived('ws');

    // When
    const chosen = bySeniority([undefined, first, derived('kafka')]);

    // Then
    expect(chosen).toEqual(first);
    expect(bySeniority([undefined, undefined])).toBeUndefined();
  });

  it('should carry the declared protocol into the synthesized document, by that level', () => {
    // Given the handler that names both halves: `@MessagePattern(..., KAFKA)` derives `kafka`
    // and `@ApiChannel({ protocol: 'mqtt' })` declares `mqtt`
    const { channels } = discoverChannels(discoveryOf([DeclaredController]));
    const reading = channels.filter((channel) => channel.address.value === 'sensors.reading');
    expect(reading).toHaveLength(1);

    // When
    const { document } = synthesizeEventsDocument(reading, { title: 'Sensors', version: '1' });
    const servers = (document as { servers?: Record<string, { protocol?: string }> }).servers ?? {};

    // Then the document names the declared protocol and not the derived one, so the level a
    // reader never sees is still what decided which protocol a reader does see
    expect(Object.keys(servers)).toEqual(['mqtt']);
    expect(servers.mqtt?.protocol).toBe('mqtt');
  });
});

describe('synthesizeEventsDocument, per SPEC 8.3', () => {
  it('should attribute each channel to the transport its own handler names', () => {
    // Given an application with two transports, which is the case `T051` names
    const discovery = discoveryOf([KafkaOrdersController, RabbitBillingController]);
    const { channels } = discoverChannels(discovery);
    expect(channels).toHaveLength(3);

    // When
    const { document } = synthesizeEventsDocument(channels, {
      title: 'Orders',
      version: 'runtime',
      servers: [
        { protocol: 'kafka', host: 'kafka.example.com:9092' },
        { protocol: 'amqp', host: 'rabbit.example.com:5672' },
      ],
    });
    const normalized = channelsOf(document);
    const byAddress = new Map(normalized.map((channel) => [channel.address, channel]));

    // Then each channel is on the broker of its own transport and on no other, and the protocol
    // follows from that binding rather than from anything this package wrote onto the channel
    expect(byAddress.get('orders.get')?.servers).toEqual([
      { url: 'kafka://kafka.example.com:9092' },
    ]);
    expect(byAddress.get('billing.settled')?.servers).toEqual([
      { url: 'amqp://rabbit.example.com:5672' },
    ]);
    expect(byAddress.get('orders.get')?.protocol).toBe('kafka');
    expect(byAddress.get('billing.settled')?.protocol).toBe('amqp');
  });

  it('should leave a handler that names no transport on every broker, which is what it is on', () => {
    // Given one handler with a transport and one without
    const { channels } = discoverChannels(
      discoveryOf([KafkaOrdersController, UntransportedController]),
    );

    // When
    const { document } = synthesizeEventsDocument(channels, {
      title: 'Orders',
      version: 'runtime',
      servers: [{ protocol: 'kafka', host: 'kafka.example.com:9092' }],
    });
    const normalized = channelsOf(document);
    const untransported = normalized.find((channel) => channel.address?.includes('cmd'));

    // Then it is bound to every declared server, which is AsyncAPI's own reading of an absent
    // `servers` block and is also the truth: a pattern naming no transport is served on every
    // microservice the host connected
    expect(untransported?.servers).toEqual([{ url: 'kafka://kafka.example.com:9092' }]);
  });

  it('should name a protocol whose host nobody configured, and say so rather than invent one', () => {
    // Given a gateway and no server configuration at all
    const { channels } = discoverChannels(discoveryOf([], [ChatGateway]));

    // When
    const { document, problems } = synthesizeEventsDocument(channels, {
      title: 'Chat',
      version: 'runtime',
    });
    const normalized = channelsOf(document);

    // Then the channel still carries the protocol, because that is the fact the discovery knows,
    // and the address it does not know is a finding rather than a hostname nobody named
    expect(normalized[0]?.protocol).toBe('ws');
    expect(normalized[0]?.address).toBe('/ws/chat');
    expect(problems.map((problem) => problem.subject)).toContain('the ws broker');
    expect(problems.find((problem) => problem.subject === 'the ws broker')?.reason).toContain(
      'no host was configured',
    );
  });

  it('should name a configured server no channel answers to, and the host that entry carries', () => {
    // Given an application whose channels speak `ws` alone, and a host who configured a broker
    // under a protocol nothing speaks, which is what a copied entry with one half edited looks
    // like. The two halves of SPEC 8.3's broker state are both present here on purpose: the `ws`
    // protocol has no host and the `kafka` entry has no channel.
    const { channels } = discoverChannels(discoveryOf([], [ChatGateway]));

    // When
    const { document, problems } = synthesizeEventsDocument(channels, {
      title: 'Chat',
      version: 'runtime',
      servers: [{ protocol: 'kafka', host: 'kafka.example.com:9092' }],
    });

    // Then the entry is named, with the host it carries, so the reader who wrote it can find it.
    // WHAT USED TO HAPPEN: `serversOf` walked the protocols the channels speak and never read a
    // configured entry nothing asked for, so this said nothing at all, and the only trace of the
    // mistake was the `ws` broker's empty host, which reads as a different problem.
    const orphan = problems.find((problem) => problem.subject === 'the configured kafka server');
    expect(orphan).toBeDefined();
    expect(orphan?.reason).toContain('kafka.example.com:9092');
    expect(orphan?.reason).toContain('no channel of this application speaks kafka');

    // And the document really did leave it out, which is what the finding says about it
    expect(Object.keys(document.servers as Record<string, unknown>)).toEqual(['ws']);
  });

  it('should refer a declared payload class to a schema and report a name nothing answers to', () => {
    // Given two `@ApiMessage` payloads, one class the host supplied a schema for and one not
    const { channels } = discoverChannels(discoveryOf([DeclaredController]));

    // When
    const { document, problems } = synthesizeEventsDocument(channels, {
      title: 'Orders',
      version: 'runtime',
      schemas: { OrderPlacedDto: { type: 'object', properties: { id: { type: 'string' } } } },
    });
    const normalized = channelsOf(document);
    const placed = normalized.find((channel) => channel.address === 'orders.placed');
    const unknown = normalized.find((channel) => channel.address === 'orders.unknown');

    // Then the one with a schema is a named reference into the one schema map of SPEC 5.1.1, and
    // the one without carries no payload and a finding naming the class, per SPEC 13.6's rule
    expect(placed?.messages[0]?.payload).toEqual({ kind: 'named', schemaId: 'OrderPlacedDto' });
    expect(placed?.messages[0]?.contentType).toBe('application/json');
    expect(unknown?.messages[0]?.payload).toBeUndefined();
    expect(problems.filter((problem) => problem.reason.includes('UndescribedDto'))).toHaveLength(1);
  });

  it('should carry a payload written as a schema object without asking for a schema table', () => {
    // Given
    const { channels } = discoverChannels(discoveryOf([DeclaredController]));

    // When
    const { document } = synthesizeEventsDocument(channels, {
      title: 'Orders',
      version: 'runtime',
    });
    const shipped = channelsOf(document).find((channel) => channel.address === 'orders.shipped');

    // Then
    expect(shipped?.messages[0]?.payload?.kind).toBe('inline');
  });

  it('should refuse to pick a channel title two handlers disagree about, and say why', () => {
    // Given two handlers on one address writing two different titles. Each is asserted to have
    // been read first, so the absent title below is a refusal rather than a declaration the walk
    // never saw.
    const { channels } = discoverChannels(discoveryOf([DisagreeingController]));
    expect(channels.map((channel) => channel.declared?.value.title).sort()).toEqual([
      'Orders, from the auditor',
      'Orders, from the writer',
    ]);

    // When
    const { document, problems } = synthesizeEventsDocument(channels, {
      title: 'Audited',
      version: '1',
    });
    const written = (document as { channels: Record<string, { title?: string }> }).channels;
    const found = problems.filter((problem) => problem.subject.includes('orders.audited'));

    // Then the channel carries no title, and the reason names both handlers. Taking the first
    // would have made the document depend on the order the container reported its providers in,
    // which is the same ambiguity `channel-pairing.ts` refuses for a runtime fact.
    expect(Object.values(written).map((channel) => channel.title)).toEqual([undefined]);
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain('DisagreeingController.wrote');
    expect(found[0]?.reason).toContain('DisagreeingController.audited');
  });

  it('should keep a channel member two handlers write identically, which is no disagreement', () => {
    // Given two handlers on one address writing the same title and the same tags
    const { channels } = discoverChannels(discoveryOf([AgreeingController]));
    expect(channels).toHaveLength(2);

    // When
    const { document, problems } = synthesizeEventsDocument(channels, {
      title: 'Agreed',
      version: '1',
    });
    const written = (
      document as {
        channels: Record<string, { title?: string; tags?: readonly { name: string }[] }>;
      }
    ).channels;

    // Then the member survives and nothing is reported: only a disagreement is ambiguous, so the
    // ordinary way of documenting a shared address once still reaches the document
    expect(Object.values(written).map((channel) => channel.title)).toEqual(['One title']);
    expect(Object.values(written)[0]?.tags).toEqual([{ name: 'orders' }, { name: 'audit' }]);
    expect(problems.filter((problem) => problem.subject.includes('orders.agreed'))).toEqual([]);
  });

  it('should produce one channel for two handlers that answer one address', () => {
    // Given a gateway whose two events share one socket address
    const { channels } = discoverChannels(discoveryOf([], [ChatGateway]));

    // When
    const { document } = synthesizeEventsDocument(channels, {
      title: 'Chat',
      version: 'runtime',
      servers: [{ protocol: 'ws', host: 'chat.example.com' }],
    });
    const normalized = channelsOf(document);

    // Then, one channel and two operations on it, both `receive`
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.operations.map((operation) => operation.direction)).toEqual([
      'receive',
      'receive',
    ]);
  });

  it('should build a document the AsyncAPI reader accepts, with no file anywhere', () => {
    // Given every source of SPEC 8.3 at once
    const { channels } = discoverChannels(
      discoveryOf(
        [KafkaOrdersController, RabbitBillingController, DeclaredController],
        [ChatGateway],
      ),
    );

    // When
    const { document } = synthesizeEventsDocument(channels, {
      title: 'Everything',
      version: 'runtime',
      servers: [
        { protocol: 'kafka', host: 'kafka.example.com:9092' },
        { protocol: 'amqp', host: 'rabbit.example.com:5672' },
        { protocol: 'ws', host: 'chat.example.com' },
        { protocol: 'mqtt', host: 'mqtt.example.com:1883' },
      ],
      schemas: { OrderPlacedDto: { type: 'object' } },
    });
    const normalized = normalizeAsyncApiDocument(document);

    // Then it is an events document with a channel per address, which is the done-when of `T051`
    expect(normalized.kind).toBe('events');
    expect([...normalized.nodes.values()].every((node) => node.kind === 'channel')).toBe(true);
    expect(normalized.nodes.size).toBe(8);
  });

  it('should produce one document however the container reports its classes', () => {
    // Given the same classes in two orders
    const forward = discoverChannels(
      discoveryOf([KafkaOrdersController, RabbitBillingController], [ChatGateway]),
    ).channels;
    const backward = discoverChannels(
      discoveryOf([RabbitBillingController, KafkaOrdersController], [ChatGateway]),
    ).channels;
    expect(forward).toHaveLength(backward.length);

    const options = {
      title: 'Orders',
      version: 'runtime',
      servers: [
        { protocol: 'kafka', host: 'kafka.example.com:9092' },
        { protocol: 'amqp', host: 'rabbit.example.com:5672' },
        { protocol: 'ws', host: 'chat.example.com' },
      ],
    };

    // When
    const left = normalizeAsyncApiDocument(synthesizeEventsDocument(forward, options).document);
    const right = normalizeAsyncApiDocument(synthesizeEventsDocument(backward, options).document);

    // Then one hash, per SPEC 5.3: a document whose shape depends on the order a container walked
    // its providers is a document whose cache key changes for no reason
    expect(left.hash).toBe(right.hash);
  });
});

describe('pairChannels, per SPEC 8.3', () => {
  it('should pair a channel served by one handler with that handler', () => {
    // Given
    const { channels } = discoverChannels(discoveryOf([KafkaOrdersController]));
    const synthesized = synthesizeEventsDocument(channels, {
      title: 'Orders',
      version: 'runtime',
      servers: [{ protocol: 'kafka', host: 'kafka.example.com:9092' }],
    });
    const document = normalizeAsyncApiDocument(synthesized.document);

    // When
    const { targets, problems } = pairChannels(document, synthesized.channels);

    // Then each channel is a collector target carrying the class and the method behind it, which
    // is what makes every existing collector run on a channel unchanged
    expect(problems).toEqual([]);
    expect(targets.map((target) => `${target.node.id} ${target.handlerName}`).sort()).toEqual([
      'channel-orders-created created',
      'channel-orders-get get',
    ]);
    expect(targets.every((target) => target.controller === KafkaOrdersController)).toBe(true);
  });

  it('should attribute nothing to a channel several handlers serve, and say why', () => {
    // Given a gateway whose two events share one address, so no handler is the channel's own
    const { channels } = discoverChannels(discoveryOf([], [ChatGateway]));
    const synthesized = synthesizeEventsDocument(channels, {
      title: 'Chat',
      version: 'runtime',
      servers: [{ protocol: 'ws', host: 'chat.example.com' }],
    });
    const document = normalizeAsyncApiDocument(synthesized.document);

    // When
    const { targets, problems } = pairChannels(document, synthesized.channels);

    // Then, and the finding names both handlers, so a reader knows which methods were left out
    expect(targets).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('ChatGateway.events');
    expect(problems[0]?.reason).toContain('ChatGateway.typing');
  });
});

/**
 * The `@nestjs-redisx` half of SPEC 8.3, from the real decorators to a normalized channel.
 *
 * WHY IT IS IN THIS PACKAGE AND NOT IN AN ECOSYSTEM ONE. The collector contract of SPEC 6.2 is
 * frozen and returns `IRNodeRuntime`, which attaches facts to a node that already exists; nothing
 * in it can create a channel. A topology source is therefore an edit to this package or it is
 * nothing, and this one costs a consumer nothing: two `Symbol.for` expressions, no import and no
 * resolution, read the way `@nestjs/microservices` is already read.
 */
@Injectable()
class RedisxProjector {
  @Subscribe('orders.created')
  onCreated(): void {
    // nothing
  }

  @Subscribe({ pattern: 'orders.*' })
  onAny(): void {
    // nothing
  }

  @StreamConsumer({ stream: 'orders', group: 'projector' })
  onStream(): void {
    // nothing
  }
}

@Injectable()
class RedisxDeclaringProjector {
  @Subscribe('payments.settled')
  @ApiChannel({ address: 'app:payments.settled', summary: 'A payment settled' })
  onSettled(): void {
    // nothing
  }
}

@Injectable()
class ForeignSymbolProvider {
  notAChannel(): void {
    // nothing
  }
}

describe('the @nestjs-redisx topology source of SPEC 8.3', () => {
  it('should read a subscription, a pattern and a stream consumer off a plain provider', () => {
    // Given a provider carrying the real decorators of two libraries, reported as a provider
    const discovery = discoveryOf([], [RedisxProjector]);
    expect(discovery.getProviders().map((wrapper) => wrapper.name)).toEqual(['RedisxProjector']);

    // When
    const { channels } = discoverChannels(discovery);

    // Then all three are channels the application really subscribes to, at `derived`, over the
    // protocol the family speaks, and each names the decorator that produced it rather than
    // `api-channel`, which would say somebody had written it down
    expect(channels.map((channel) => channel.address.value)).toEqual([
      'orders.created',
      'orders.*',
      'orders',
    ]);
    expect(channels.map((channel) => channel.source)).toEqual([
      'redisx-subscribe',
      'redisx-subscribe',
      'redisx-stream-consumer',
    ]);
    expect(channels.every((channel) => channel.address.confidence === 'derived')).toBe(true);
    expect(channels.every((channel) => channel.protocol?.value === 'redis')).toBe(true);
  });

  it('should say the prefix is not read rather than inventing the wire name', () => {
    // Given the same provider, whose plugins concatenate a configured prefix this walk never
    // resolves
    const discovery = discoveryOf([], [RedisxProjector]);

    // When
    const { problems } = discoverChannels(discovery);

    // Then one finding per channel says so, and the glob gets a second one of its own, because a
    // pattern is an address and is not a concrete one
    expect(problems.map((problem) => problem.subject)).toEqual([
      'RedisxProjector.onCreated',
      'RedisxProjector.onAny',
      'RedisxProjector.onAny',
      'RedisxProjector.onStream',
    ]);
    expect(problems[1]?.reason).toContain('Redis glob');
    expect(problems.filter((problem) => problem.reason.includes('prefix'))).toHaveLength(3);
    expect(problems.every((problem) => problem.action !== undefined)).toBe(true);
  });

  it('should let @ApiChannel outrank the routed address, and file one channel and not two', () => {
    // Given a handler carrying both, which is the case SPEC 6.1's seniority is about
    const discovery = discoveryOf([], [RedisxDeclaringProjector]);

    // When
    const { channels } = discoverChannels(discovery);

    // Then one channel, the declared address, and the source still names what routes it, so a
    // reader can tell a declaration that overrode a subscription from a declaration alone
    expect(channels).toHaveLength(1);
    expect(channels[0]?.address.value).toBe('app:payments.settled');
    expect(channels[0]?.address.confidence).toBe('declared');
    expect(channels[0]?.source).toBe('redisx-subscribe');
    expect(channels[0]?.declared?.value.summary).toBe('A payment settled');
  });

  it('should refuse an object under the key that is not this family, since the key is global', () => {
    // Given the same global symbol carrying somebody else's object, asserted written first: a
    // proof of absence over a key nothing wrote would pass over nothing
    const handler = Object.getOwnPropertyDescriptor(ForeignSymbolProvider.prototype, 'notAChannel')
      ?.value as object;
    Reflect.defineMetadata(Symbol.for('PUBSUB_SUBSCRIBE_METADATA'), { topic: 'not.ours' }, handler);
    expect(Reflect.getMetadata(Symbol.for('PUBSUB_SUBSCRIBE_METADATA'), handler)).toEqual({
      topic: 'not.ours',
    });

    // When
    const { channels } = discoverChannels(discoveryOf([], [ForeignSymbolProvider]));

    // Then nothing is filed, because the shape and not the key is what admits an object
    expect(channels).toEqual([]);
  });

  it('should reach an IRChannel through the synthesis and the normalizer', () => {
    // Given the whole chain, which is the only proof that a subscription reaches a reader
    const { channels } = discoverChannels(discoveryOf([], [RedisxProjector]));

    // When
    const synthesized = synthesizeEventsDocument(channels, { title: 'Orders', version: '1.0.0' });
    const normalized = channelsOf(synthesized.document);

    // Then
    expect(normalized.map((channel) => channel.address).sort()).toEqual([
      'orders',
      'orders.*',
      'orders.created',
    ]);
    expect(normalized.every((channel) => channel.protocol === 'redis')).toBe(true);
  });
});

import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, Injectable, Module, UseGuards } from '@nestjs/common';
import type { CanActivate, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventPattern, MessagePattern, Transport } from '@nestjs/microservices';
import { OpenRefModule } from '../../src/api/openref.module';
import { MountedReferences } from '../../src/api/mounted-references';
import { ApiChannel, ApiMessage, ApiScopes } from '../../src/api/decorators/api-decorators';
import { OPENREF_REFERENCES } from '../../src/shared/constants/tokens';
import { guardsCollector } from '../../src/runtime/infrastructure/collectors/guards.collector';
import { declarationsCollector } from '../../src/runtime/infrastructure/collectors/declarations.collector';
import { assetPlan } from '../mocks/fixtures';

/**
 * The done-when of `T051`, over real HTTP: events appear in the documentation with no AsyncAPI file.
 *
 * WHAT ONLY THIS FILE CAN PROVE. The unit suite runs the discovery against the structural types,
 * which is what keeps this package framework free, and no fake answers the question the feature
 * turns on: whether `DiscoveryService` reports a `@WebSocketGateway` provider and a
 * `@MessagePattern` controller at the moment `onModuleInit` runs, and whether a reader who opens
 * the mount gets a page with the channels on it.
 *
 * THE APPLICATION CONNECTS NO MICROSERVICE, DELIBERATELY. `app.connectMicroservice` needs a
 * transport package and a broker to be running, and the reference does not read either: SPEC 8.3
 * says the channels come from metadata under keys this package names, so the proof of that is a
 * document built from the decorators alone.
 *
 * NO `@WebSocketGateway` IS REGISTERED HERE, AND THE REASON IS THE FRAMEWORK'S RATHER THAN OURS.
 * A gateway in the providers list makes `SocketModule` load a websocket adapter at boot, which
 * needs `socket.io` installed, and an application that cannot boot proves nothing about a
 * reference. The gateway half of SPEC 8.3 is exercised in `test/unit/event-discovery.spec.ts`
 * against the real `@WebSocketGateway` and `@SubscribeMessage` decorators, which is where the
 * metadata this package reads is actually written; what only this file can prove is the container
 * and the routes, and the microservice controllers exercise both.
 */

const PLATFORMS = ['express', 'fastify'] as const;

@Injectable()
class TenantGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Controller()
class OrdersController {
  @UseGuards(TenantGuard)
  @ApiScopes('orders:read')
  @MessagePattern('orders.get', Transport.KAFKA)
  get(): string {
    return 'an order';
  }

  @EventPattern('orders.created', Transport.KAFKA)
  created(): void {
    // nothing
  }
}

@Controller()
class BillingController {
  @EventPattern('billing.settled', Transport.RMQ)
  settled(): void {
    // nothing
  }

  @ApiChannel({ address: 'billing.refunded', protocol: 'amqp', summary: 'A refund went out' })
  @ApiMessage({ payload: { type: 'object', properties: { id: { type: 'string' } } } })
  refunded(): void {
    // nothing
  }
}

/**
 * Two handlers answering one address, which is SPEC 8.3's ambiguity case.
 *
 * IT IS IN THE FIXTURE RATHER THAN IN A CASE OF ITS OWN, because the thing under test is what the
 * mount does with the pairing's second half, and the mount happens once per application. A guard
 * read off either of these two is a guard on one of the channel's operations and not on the
 * channel, so the channel carries no runtime block and the reason is a problem naming both.
 */
@Controller()
class ShippingController {
  @EventPattern('shipping.updated', Transport.KAFKA)
  dispatched(): void {
    // nothing
  }

  @EventPattern('shipping.updated', Transport.KAFKA)
  delivered(): void {
    // nothing
  }
}

@Module({
  controllers: [OrdersController, BillingController, ShippingController],
  providers: [TenantGuard],
  imports: [
    OpenRefModule.forRoot({
      documents: [
        {
          id: 'events',
          route: '/docs/events',
          kind: 'events',
          title: 'Orders events',
          assetPlan: assetPlan(),
          servers: [
            { protocol: 'kafka', host: 'kafka.example.com:9092' },
            { protocol: 'amqp', host: 'rabbit.example.com:5672' },
          ],
        },
      ],
      runtime: { collectors: [guardsCollector(), declarationsCollector()] },
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class EventsModule {}

let running: INestApplication | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function boot(platform: (typeof PLATFORMS)[number]): Promise<string> {
  const app =
    platform === 'fastify'
      ? await (async (): Promise<INestApplication> => {
          const { FastifyAdapter } = await import('@nestjs/platform-fastify');
          return NestFactory.create(EventsModule as never, new FastifyAdapter(), {
            logger: false,
            abortOnError: false,
          });
        })()
      : await NestFactory.create(EventsModule as never, { logger: false, abortOnError: false });

  running = app;
  await app.listen(0, '127.0.0.1');

  return app.getUrl();
}

function references(): MountedReferences {
  const resolved = running?.get(OPENREF_REFERENCES, { strict: false });
  if (!(resolved instanceof MountedReferences)) throw new Error('forRoot registered no provider');

  return resolved;
}

for (const platform of PLATFORMS) {
  describe(`a NestJS application whose events are documented on ${platform}`, () => {
    it('should build an events document from the application with no file anywhere', async () => {
      // Given an application whose only description of its events is its own decorators
      await boot(platform);

      // When
      const mounted = references().get('events');
      const document = mounted?.service.document;

      // Then, a real events document with one channel per address, which is the `T051` done-when
      expect(document?.kind).toBe('events');
      expect([...(document?.nodes.values() ?? [])].map((node) => node.kind)).toEqual([
        'channel',
        'channel',
        'channel',
        'channel',
        'channel',
      ]);
      // Five channels for six handlers, because the two on `shipping.updated` are one address
      expect(
        [...(document?.nodes.values() ?? [])]
          .map((node) => (node.kind === 'channel' ? node.address : ''))
          .sort(),
      ).toEqual([
        'billing.refunded',
        'billing.settled',
        'orders.created',
        'orders.get',
        'shipping.updated',
      ]);
    });

    it('should attribute each channel to the broker of its own transport', async () => {
      // Given
      await boot(platform);
      const document = references().get('events')?.service.document;
      const byAddress = new Map(
        [...(document?.nodes.values() ?? [])].flatMap((node) =>
          node.kind === 'channel' && node.address !== undefined
            ? ([[node.address, node]] as const)
            : [],
        ),
      );
      // The comparison means nothing unless all three brokers really were declared, so the
      // document's own server list is asserted before the per channel bindings are read.
      expect(document?.servers.map((server) => server.protocol).sort()).toEqual(['amqp', 'kafka']);

      // When
      const protocols = ['orders.get', 'billing.settled', 'billing.refunded'].map(
        (address) => byAddress.get(address)?.protocol,
      );

      // Then, which is the two transport clause of `T051`: each channel on the one it names,
      // including the one whose protocol a person declared rather than a transport
      expect(protocols).toEqual(['kafka', 'amqp', 'amqp']);
    });

    it('should give a channel the runtime facts its handler carries', async () => {
      // Given, and the channel is asserted present before its facts are read, so a channel that
      // stopped being produced cannot look like a channel with no facts
      await boot(platform);
      const document = references().get('events')?.service.document;
      const channel = document?.nodes.get('channel-orders-get');
      expect(channel?.kind).toBe('channel');

      // When
      const runtime = channel?.runtime;

      // Then every fact carries its collector and its confidence, because it came through the
      // registry `T017` froze rather than through a second mechanism, per SPEC 8.3
      expect(runtime?.guards).toEqual([
        {
          name: 'TenantGuard',
          scope: 'route',
          confidence: 'derived',
          collector: 'guardsCollector',
        },
      ]);
      expect(runtime?.scopes).toEqual({
        value: ['orders:read'],
        confidence: 'declared',
        collector: 'declarationsCollector',
      });
    });

    it('should leave a channel whose handler carries no fact without a runtime block', async () => {
      // Given the channel `@EventPattern` produced with no guard and no scopes on it, which is
      // the state a reader has to be able to tell from a channel nothing looked at
      await boot(platform);
      const document = references().get('events')?.service.document;
      const created = document?.nodes.get('channel-orders-created');
      expect(created?.kind).toBe('channel');

      // When
      const runtime = created?.runtime;

      // Then no block at all, per SPEC 6.3's absence rule: the collectors ran and had nothing
      // to say, which is what an empty panel would have said wrongly
      expect(runtime).toBeUndefined();
    });

    it('should serve the channel page and the asyncapi document, and refuse the openapi one', async () => {
      // Given
      const url = await boot(platform);

      // When
      const page = await fetch(`${url}/docs/events/channel-orders-get`);
      const body = await page.text();
      const asyncapi = await fetch(`${url}/docs/events/asyncapi.json`);
      const parsed = (await asyncapi.json()) as Record<string, unknown>;
      const openapi = await fetch(`${url}/docs/events/openapi.json`);
      const refusal = await openapi.text();

      // Then the page draws the channel, the machine answer is a real AsyncAPI document, and the
      // OpenAPI address says which family this reference is rather than serving the other one
      expect(page.status).toBe(200);
      expect(body).toContain('orders.get');
      expect(asyncapi.status).toBe(200);
      expect(parsed.asyncapi).toBe('3.1.0');
      expect(openapi.status).toBe(404);
      expect(refusal).toContain('asyncapi.json');
    });

    it('should report what it could not state rather than leaving it out in silence', async () => {
      // Given, and the two halves this case owes are the two SPEC 8.3 states of a broker: a
      // protocol the host configured, which is named nowhere, and every problem being a sentence
      // a reader can act on rather than a list that merely exists. It asserted only `Array.isArray`
      // and one empty filter until the second review of `T051`, which is a shape and not a claim.
      await boot(platform);
      const mounted = references().get('events');
      const servers = mounted?.service.document.servers ?? [];

      // When
      const problems = mounted?.eventProblems ?? [];
      const brokers = problems.filter((problem) => problem.subject.endsWith('broker'));

      // Then every protocol the document speaks has the host the host configured, which is what
      // makes the empty broker list a fact about this application rather than about an empty
      // haystack: a server here with no host is exactly what `serversOf` names.
      expect(servers.map((server) => server.url).sort()).toEqual([
        'amqp://rabbit.example.com:5672',
        'kafka://kafka.example.com:9092',
      ]);
      expect(brokers).toEqual([]);

      // And the list is not empty and every entry reads as a finding, so "reports rather than
      // stays silent" is measured on something the application actually could not state.
      expect(problems.length).toBeGreaterThan(0);
      expect(
        problems.filter((problem) => problem.subject !== '' && problem.reason.length > 20),
      ).toHaveLength(problems.length);
    });

    it('should carry the ambiguity of a channel two handlers serve into the problems', async () => {
      // Given the application above, whose `shipping.updated` is answered twice. The channel is
      // asserted present and factless first, so the problem below explains a real state rather
      // than describing a channel that was never produced.
      await boot(platform);
      const mounted = references().get('events');
      const channel = mounted?.service.document.nodes.get('channel-shipping-updated');
      expect(channel?.kind).toBe('channel');
      expect(channel?.runtime).toBeUndefined();

      // When
      const ambiguity = (mounted?.eventProblems ?? []).filter((problem) =>
        problem.subject.includes('shipping.updated'),
      );

      // Then the explanation SPEC 8.3 owes a reader reaches the list `doctor` is to print from,
      // naming both handlers. It was built by `pairChannels` and discarded by the mount until the
      // review of `T051`, so a reader saw a channel with no facts and no reason anywhere.
      expect(ambiguity).toHaveLength(1);
      expect(ambiguity[0]?.reason).toContain('2 handlers serve it');
      expect(ambiguity[0]?.reason).toContain('ShippingController.dispatched');
      expect(ambiguity[0]?.reason).toContain('ShippingController.delivered');
    });
  });
}

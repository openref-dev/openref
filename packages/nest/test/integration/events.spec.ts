import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, Get, Injectable, Module, UseGuards } from '@nestjs/common';
import type { CanActivate, INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { EventPattern, MessagePattern, Transport } from '@nestjs/microservices';
import { OpenRefModule } from '../../src/api/openref.module';
import { MountedReferences } from '../../src/api/mounted-references';
import { ApiChannel, ApiMessage, ApiScopes } from '../../src/api/decorators/api-decorators';
import { OPENREF_REFERENCES } from '../../src/shared/constants/tokens';
import { guardsCollector } from '../../src/runtime/infrastructure/collectors/guards.collector';
import { declarationsCollector } from '../../src/runtime/infrastructure/collectors/declarations.collector';
import { buildDoctorReport } from '@openref/core';
import { assetPlan, specification } from '../mocks/fixtures';

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

    it('should print every one of those problems through doctor, which nothing did before T054', async () => {
      // Given the booted application above. SPEC 8.3 called six of these «находка `doctor`» from
      // `T051`, and `doctor` printed none: the list ended on the mount, `RuntimePassResult` held
      // the HTTP half, and `buildDoctorReport` sees a document rather than either.
      await boot(platform);
      const mounted = references().get('events');
      const problems = mounted?.eventProblems ?? [];
      const document = mounted?.service.document;

      // The subject is asserted present before its absence anywhere else is claimed.
      expect(problems.length).toBeGreaterThan(0);

      // When the document is read the way the CLI reads it, which is the whole of what `doctor`
      // gets: `runWithDocument` hands it `pass.document` and nothing else off the mount.
      const carried = document?.runtime?.problems ?? [];
      expect(document).toBeDefined();
      const report = buildDoctorReport(document!);
      const printed = report.findings.filter((finding) => finding.rule === 'discovery-incomplete');

      // Then every problem the mount found is on the document, and every one of them is a printed
      // finding under the display code of SPEC 7.1, naming the subject the discovery named.
      expect(carried.map((problem) => problem.subject)).toEqual(
        expect.arrayContaining(problems.map((problem) => problem.subject)),
      );
      expect(printed.map((finding) => finding.subject)).toEqual(
        expect.arrayContaining(problems.map((problem) => problem.subject)),
      );
      expect(printed).toHaveLength(carried.length);
      expect(new Set(printed.map((finding) => finding.code))).toEqual(new Set(['RT070']));

      // And the ambiguity of `shipping.updated`, which is the one of the six a reader most needs
      // the explanation for, is one of the printed ones rather than merely one of the carried.
      const ambiguity = printed.filter((finding) => finding.subject.includes('shipping.updated'));
      expect(ambiguity).toHaveLength(1);
      expect(ambiguity[0]?.suggestion).toContain('2 handlers serve it');
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

/**
 * SPEC 8.3's third class kind, booted: a plain provider is the only thing declaring a channel.
 *
 * WHAT ONLY THIS FILE CAN PROVE, and it is not the walk. `event-discovery.spec.ts` hands the walk a
 * `DiscoveryService` this project wrote; what nothing proved until 2026-09-04 is that Nest's own
 * `DiscoveryService.getProviders()` reports a plain `@Injectable()` at the moment `onModuleInit`
 * runs, and that a channel produced from it reaches the served document, its broker and its runtime
 * facts. Every case in this file until now put `@ApiChannel` on a `@Controller`, which is the one
 * class kind `collectPatterns` already reached, so the form the shipped example and five prose
 * surfaces present as ordinary was proved nowhere.
 *
 * NOTHING HERE IS A CONTROLLER, WHICH IS THE POINT. `ProjectorOnlyModule` registers no controller
 * at all, so a channel in its document came from the provider walk and from nowhere else.
 */
@Injectable()
class OrdersProjector {
  @ApiScopes('orders:project')
  @ApiChannel({
    address: 'orders.projected',
    protocol: 'kafka',
    direction: 'receive',
    summary: 'An order was projected',
  })
  @ApiMessage({ payload: { type: 'object', properties: { id: { type: 'string' } } } })
  onProjected(): void {
    // nothing
  }
}

@Module({
  providers: [OrdersProjector],
  imports: [
    OpenRefModule.forRoot({
      documents: [
        {
          id: 'events',
          route: '/docs/events',
          kind: 'events',
          title: 'Projected events',
          assetPlan: assetPlan(),
          servers: [{ protocol: 'kafka', host: 'kafka.example.com:9092' }],
        },
      ],
      runtime: { collectors: [declarationsCollector()] },
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class ProjectorOnlyModule {}

describe('a NestJS application whose only channel is declared on a plain provider', () => {
  it('should discover it, serve it, bind it to its broker and give it its runtime facts', async () => {
    // Given an application with no controller and no gateway anywhere in it
    const app = await NestFactory.create(ProjectorOnlyModule as never, {
      logger: false,
      abortOnError: false,
    });
    running = app;
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();

    // The subject is asserted present before anything is proved about it: this module really does
    // register the provider, and really does register no controller.
    const mounted = references().get('events');
    const document = mounted?.service.document;
    expect(document?.kind).toBe('events');

    // When
    const channels = [...(document?.nodes.values() ?? [])].filter(
      (node) => node.kind === 'channel',
    );
    const served = await fetch(`${url}/docs/events/asyncapi.json`);
    const parsed = (await served.json()) as {
      channels?: Record<string, { address?: string }>;
      servers?: Record<string, { protocol?: string }>;
    };

    // Then the channel exists, at the address the decorator gave it, in the document a reader gets
    expect(channels.map((node) => node.address)).toEqual(['orders.projected']);
    expect(served.status).toBe(200);
    expect(Object.values(parsed.channels ?? {}).map((channel) => channel.address)).toEqual([
      'orders.projected',
    ]);

    // And the broker the mount configured reaches the document, which it could not while there
    // were no channels to name a protocol
    expect(Object.values(parsed.servers ?? {}).map((server) => server.protocol)).toEqual(['kafka']);

    // And the runtime pass visits it, so the collectors configured on this mount contribute to a
    // node instead of running over an empty map
    expect(channels[0]?.runtime?.scopes).toEqual({
      value: ['orders:project'],
      confidence: 'declared',
      collector: 'declarationsCollector',
    });
  });

  it('should stop reporting a liveness of ok for a reference that describes nothing', async () => {
    // Given an application whose events mount has no channel at all, which is the state
    // `examples/events` served for two milestones while `_health` answered `ok`
    @Injectable()
    class SilentProjector {
      onNothing(): void {
        // no @ApiChannel anywhere
      }
    }

    @Module({
      providers: [SilentProjector],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'events',
              route: '/docs/events',
              kind: 'events',
              title: 'No events at all',
              assetPlan: assetPlan(),
            },
          ],
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class EmptyEventsModule {}

    const app = await NestFactory.create(EmptyEventsModule as never, {
      logger: false,
      abortOnError: false,
    });
    running = app;
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();

    // When
    const reply = await fetch(`${url}/docs/events/_health`);
    const health = (await reply.json()) as { status?: string; document?: { nodes?: number } };

    // Then the probe still answers, because the process is up, and the word it answers with is not
    // the word that means the reference is serviceable, per SPEC 13.3
    expect(reply.status).toBe(200);
    expect(health.document?.nodes).toBe(0);
    expect(health.status).toBe('empty');
  });
});

/**
 * The HTTP half of the same problem list, which had no end-to-end case until the review of `T054`.
 *
 * WHY IT IS IN THIS FILE. `IRRuntimeMeta.problems` is one carrier for two producers: the event
 * discovery, whose findings arrive through `carriedProblems`, and the runtime walk, whose findings
 * `runRuntimePass` appends itself. The case above proves the first reaches `doctor`; nothing proved
 * the second, and the section that claims it says "a test per case proves the named finding reaches
 * the printed report", so the claim was answered for one producer of the two. Keeping both halves
 * beside each other is what makes the pair readable: one list, two sources, one printed rule.
 *
 * THE APPLICATION IS HTTP AND HAS NO EVENTS AT ALL, deliberately. `eventProblems` is undefined on
 * this mount, so anything on the document came from the walk and from nowhere else. A document with
 * both would prove the carrier works and leave which half filled it unanswered.
 */
@Controller('orders')
class GuardedOrdersController {
  @Get(':id')
  readOrder(): string {
    return 'an order';
  }
}

@Module({
  controllers: [GuardedOrdersController],
  // `useValue` with a plain object is the shape SPEC 6.2.1 cannot name: it protects every route
  // and has no class name to report, which is the one HTTP discovery problem an application can
  // produce with no other defect in it.
  providers: [{ provide: APP_GUARD, useValue: { canActivate: (): boolean => true } }],
  imports: [
    OpenRefModule.forRoot({
      documents: [
        { id: 'http', route: '/docs/http', document: specification(), assetPlan: assetPlan() },
      ],
      runtime: { collectors: [guardsCollector()] },
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class UnnameablyGuardedModule {}

describe('a NestJS application the runtime walk cannot fully read', () => {
  it('should print the HTTP half of the problem list through doctor, as RT070 with its subject', async () => {
    // Given an application behind one guard the reference cannot name. It is booted on express
    // alone, because what is under test is the container walk and the carrier, and neither reads
    // the adapter; the platform loop above is what covers the two adapters.
    const app = await NestFactory.create(UnnameablyGuardedModule as never, {
      logger: false,
      abortOnError: false,
    });
    running = app;
    await app.listen(0, '127.0.0.1');

    const mounted = references().get('http');
    const pass = mounted?.pass;
    const document = pass?.document;

    // The subject is asserted present, and asserted to come from the HTTP half, before anything is
    // claimed about where it reaches. An events document is what the case above measures, so this
    // mount having no event problems at all is what makes the assertions below about the walk.
    expect(document?.kind).toBe('http');
    expect(mounted?.eventProblems).toBeUndefined();
    expect(pass?.discoveryProblems.map((problem) => problem.subject)).toEqual(['the application']);
    expect(pass?.discoveryProblems[0]?.reason).toContain('APP_GUARD');

    // When the document is read the way the CLI reads it, which is the whole of what `doctor`
    // gets: `runWithDocument` hands it `pass.document` and nothing else off the mount.
    expect(document).toBeDefined();
    const carried = document?.runtime?.problems ?? [];
    const report = buildDoctorReport(document!);
    const printed = report.findings.filter((finding) => finding.rule === 'discovery-incomplete');

    // Then the walk's own finding is on the document, and it is printed under the display code of
    // SPEC 7.1 naming the subject the walk named. Until `T054` it reached neither: the pass held
    // it, nothing downstream read the pass, and `doctor` sees a document.
    expect(carried).toEqual(pass?.discoveryProblems);
    expect(printed).toHaveLength(1);
    expect(printed[0]?.code).toBe('RT070');
    expect(printed[0]?.subject).toBe('the application');
    expect(printed[0]?.suggestion).toContain('APP_GUARD');

    // And no route of this application carries a guard row, which is the other half of the same
    // fact: the problem exists because the name does not, so a row here would be a name nobody
    // wrote and the finding would be redundant rather than owed.
    expect(
      [...(document?.nodes.values() ?? [])].filter((node) => node.runtime?.guards !== undefined),
    ).toEqual([]);
    expect(document?.nodes.size, 'the document has no operation, so it proves nothing').toBe(1);
  });
});

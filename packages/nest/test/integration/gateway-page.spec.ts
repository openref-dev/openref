import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventPattern, Transport } from '@nestjs/microservices';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { normalizeOpenApiDocument } from '@openref/core';
import { mergeDocuments } from '@openref/federation';
import { buildNavigation, createMarkdownRenderer, renderPage } from '@openref/render';
import { afterEach, describe, expect, it } from 'vitest';
import type { NavEntryModel } from '@openref/render';
import { ApiChannel } from '../../src/api/decorators/api-decorators';
import { MountedReferences } from '../../src/api/mounted-references';
import { OpenRefModule } from '../../src/api/openref.module';
import { OPENREF_REFERENCES } from '../../src/shared/constants/tokens';
import { assetPlan } from '../mocks/fixtures';

/**
 * The M5 condition of SPEC 22, met by a boot rather than by a double.
 *
 * WHAT WAS HELD BY A DOUBLE UNTIL `T065`. SPEC 22's M5 clause is that an application with a broker
 * and a WebSocket gateway is documented on one page beside its HTTP. The gateway half was held by
 * `test/unit/event-discovery.spec.ts`, which drives `discoverChannels` over a hand built
 * `DiscoveryService` carrying real `@WebSocketGateway` and `@SubscribeMessage` metadata. That case
 * proves this package reads what Nest writes. It cannot reach the joint the clause names: that
 * `DiscoveryService` reports a gateway PROVIDER at the moment `onModuleInit` runs, and that a
 * reader gets a page with the gateway's channels on it.
 *
 * WHY IT COULD NOT BE BOOTED BEFORE, AND WHY THE APPROVED DEPENDENCY IS NOT SPENT. A gateway in
 * the providers list makes `SocketModule` load a websocket adapter at boot, and `loadAdapter`
 * calls `process.exit(1)` when it cannot resolve `@nestjs/platform-socket.io`, which is why the
 * header of `test/integration/events.spec.ts` says a gateway cannot be registered there. The
 * maintainer approved `socket.io` as a devDependency of this package on 2026-08-30 for exactly
 * this probe. Measured at `T065`: it does not answer, because the package the framework loads is
 * `@nestjs/platform-socket.io` and not `socket.io`, and it is not needed either, because
 * `useWebSocketAdapter` is the framework's own seam for a host that brings its own transport.
 * The approval is therefore recorded as UNSPENT rather than consumed for the look of it, and no
 * transport package is installed anywhere in this repository.
 *
 * WHY THE PAGE IS A MERGE. No specification format writes `paths` and `channels` together, so a
 * mixed document has exactly one producer, `mergeKind` in `@openref/federation` per SPEC 15.1, and
 * `packages/nest/test/integration/mixed-page.spec.ts` gives the reason at length. What is new here
 * is that the events half is not a corpus file: it is the document this application produced from
 * its own decorators, gateway included, at boot.
 */

@WebSocketGateway(8081, { namespace: 'chat', path: '/ws' })
class ChatGateway {
  @SubscribeMessage('message')
  onMessage(): string {
    return 'ok';
  }

  @SubscribeMessage('typing')
  onTyping(): string {
    return 'ok';
  }
}

@Controller()
class OrdersEventsController {
  @ApiChannel({ address: 'orders.created' })
  @EventPattern('orders.created', Transport.RMQ)
  onOrderCreated(): void {
    // The handler body is not the subject; the metadata above it is.
  }
}

@Controller('orders')
class OrdersHttpController {
  @Get()
  list(): readonly string[] {
    return [];
  }
}

@Module({
  controllers: [OrdersEventsController, OrdersHttpController],
  providers: [ChatGateway],
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
            { protocol: 'amqp', host: 'rabbit.example.com:5672' },
            { protocol: 'ws', host: 'ws.example.com' },
          ],
        },
      ],
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class GatewayModule {}

/** The HTTP half, as an ordinary OpenAPI document a host would hand over. */
const HTTP_SPECIFICATION = {
  openapi: '3.1.0',
  info: { title: 'Orders HTTP', version: '1.0.0' },
  paths: {
    '/orders': {
      get: { operationId: 'listOrders', responses: { '200': { description: 'ok' } } },
    },
  },
};

let running: INestApplication | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/**
 * A websocket adapter that opens nothing.
 *
 * NO TRANSPORT PACKAGE IS INSTALLED FOR THIS, AND THAT IS THE POINT. `SocketModule` loads
 * `@nestjs/platform-socket.io` at boot only when the application configured no adapter, and
 * `loadAdapter` calls `process.exit(1)` when it cannot resolve it, which is why
 * `test/integration/events.spec.ts` registers no gateway. `useWebSocketAdapter` is the framework's
 * own seam for a host that brings its own transport, so the gateway is registered, connected and
 * discovered while nothing is listening. That is the right shape for this proof rather than a
 * shortcut: SPEC 8.3 says the channels come from metadata under keys this package names, so a real
 * socket server would add a listening port and not one fact. The maintainer's approval of
 * `socket.io` as a devDependency of 2026-08-30 is therefore unspent, and it is recorded as unspent
 * rather than consumed for the look of it.
 */
class SilentWsAdapter {
  create(): unknown {
    return { on: (): void => undefined, close: (): void => undefined };
  }

  bindClientConnect(): void {
    // nothing connects
  }

  bindClientDisconnect(): void {
    // nothing disconnects
  }

  bindMessageHandlers(): void {
    // nothing is bound; the metadata is what this suite reads
  }

  close(): void {
    // nothing to close
  }

  dispose(): void {
    // nothing to dispose
  }
}

async function boot(): Promise<void> {
  const app = await NestFactory.create(GatewayModule as never, {
    logger: false,
    abortOnError: false,
  });
  running = app;
  app.useWebSocketAdapter(new SilentWsAdapter() as never);
  await app.init();
}

function references(): MountedReferences {
  const resolved = running?.get(OPENREF_REFERENCES, { strict: false });
  if (!(resolved instanceof MountedReferences)) throw new Error('forRoot registered no provider');

  return resolved;
}

describe('an application with a broker handler and a real WebSocket gateway', () => {
  it('should reach the gateway through the container at onModuleInit, not through a double', async () => {
    // Given a booted application whose providers really carry a `@WebSocketGateway`
    await boot();

    // When
    const document = references().get('events')?.service.document;
    const addresses = [...(document?.nodes.values() ?? [])].flatMap((node) =>
      node.kind === 'channel' && node.address !== undefined ? [node.address] : [],
    );

    // Then, the gateway's two `@SubscribeMessage` methods are one address, the way a socket.io
    // gateway is one connection, and the broker handler is beside it. The subject is present: an
    // application that failed to register the gateway would show only the broker address.
    expect(addresses.sort()).toEqual(['/ws/chat', 'orders.created']);
    expect(document?.kind).toBe('events');
  });

  it('should mark the gateway channel with the protocol the framework implies, at derived', async () => {
    // Given
    await boot();
    const document = references().get('events')?.service.document;

    // When
    const gateway = [...(document?.nodes.values() ?? [])].find(
      (node) => node.kind === 'channel' && node.address === '/ws/chat',
    );

    // Then, `ws` and `derived`, because a gateway declares a transport by being one rather than
    // by naming it, which is the confidence rule of SPEC 6.1
    expect(gateway?.kind).toBe('channel');
    if (gateway?.kind !== 'channel') throw new Error('the gateway channel is not a channel');
    expect(gateway.protocol).toBe('ws');
  });

  it("should put the gateway's channels on one page beside the HTTP operations", async () => {
    // Given the events document this application produced and the HTTP document a host hands over
    await boot();
    const events = references().get('events')?.service.document;
    if (events === undefined) throw new Error('the events reference produced no document');
    const http = normalizeOpenApiDocument(HTTP_SPECIFICATION);

    // When, the one producer of a mixed document, per SPEC 15.1
    const { document: merged } = mergeDocuments(
      [
        { id: 'http', document: http },
        { id: 'events', document: events },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1.0.0' } },
    );
    const walk = (entry: NavEntryModel): string[] => [
      entry.label,
      entry.hint,
      ...entry.children.flatMap(walk),
    ];
    const labels = buildNavigation(merged).flatMap(walk);

    // Then, one page whose navigation carries both, which is the joint the unit double cannot
    // reach: the document is mixed, the gateway address is on it, and so is the HTTP operation.
    expect(merged.kind).toBe('mixed');
    expect(labels).toContain('/ws/chat');
    expect(labels).toContain('orders.created');
    expect(labels.some((label) => label.includes('/orders'))).toBe(true);
  });

  it('should render that one page, so the reader half is a page and not a document', async () => {
    // Given the same merged document
    await boot();
    const events = references().get('events')?.service.document;
    if (events === undefined) throw new Error('the events reference produced no document');
    const { document: merged } = mergeDocuments(
      [
        { id: 'http', document: normalizeOpenApiDocument(HTTP_SPECIFICATION) },
        { id: 'events', document: events },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1.0.0' } },
    );

    // When, the overview of the one merged document, and the node page of the HTTP half
    const overview = await renderPage(merged, {
      basePath: '/docs',
      markdown: await createMarkdownRenderer(),
    });
    const httpNode = [...merged.nodes.values()].find((node) => node.kind === 'operation');
    if (httpNode === undefined) throw new Error('the merge kept no HTTP operation');
    const operation = await renderPage(merged, {
      basePath: '/docs',
      nodeId: httpNode.id,
      markdown: await createMarkdownRenderer(),
    });

    // Then, the reader's overview carries both channel addresses, and the HTTP half of the same
    // document renders its own page from the same merge
    expect(overview.appHtml).toContain('/ws/chat');
    expect(overview.appHtml).toContain('orders.created');
    expect(operation.appHtml).toContain('/orders');
    expect(overview.documentHash).toBe(operation.documentHash);
  });
});

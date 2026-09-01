import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { OpenRefModule } from '../../src/api/openref.module';
import { MountedReferences } from '../../src/api/mounted-references';
import { OPENREF_REFERENCES } from '../../src/shared/constants/tokens';
import type { IRuntimeCollector } from '../../src/runtime/application/ports/collector.port';
import { assetPlan, specification } from '../mocks/fixtures';

/**
 * `forRoot` against a real NestJS application, on both adapters.
 *
 * WHAT ONLY THIS FILE CAN PROVE. The unit suite exercises the pass against the structural types,
 * which is what keeps it framework free, and no fake can answer the question this entry actually
 * turns on: whether `DiscoveryService` resolves, whether the container is complete by the hook
 * the mounting uses, and whether a route registered from inside `onModuleInit` is still ahead of
 * the not found handler on Express, which matches in registration order.
 *
 * THE DOCUMENT IS WRITTEN BY HAND RATHER THAN BY `SwaggerModule`, which is not a shortcut. This
 * package does not depend on `@nestjs/swagger` and must not start to; the two arms of the
 * compatibility matrix boot real applications that do use it, against two of its majors. What is
 * being checked here is the pairing and the wiring, and both are exercised harder by a document
 * whose paths were written independently of the controller.
 */

const PLATFORMS = ['express', 'fastify'] as const;

/** A collector with something to say, so a fact landing on the right node is observable. */
const scopesCollector: IRuntimeCollector = {
  name: 'scopesCollector',
  collect: (context) => ({ scopes: context.fact([`${context.node.id}:read`], 'declared') }),
};

@Controller('orders')
class OrdersController {
  @Get(':id')
  readOrder(): string {
    return 'an order';
  }

  @Post()
  createOrder(): string {
    return 'created';
  }
}

/** The document the reference serves: one operation the controller has, one it does not. */
function document(): Record<string, unknown> {
  const base = specification();
  const paths = base.paths as Record<string, unknown>;

  paths['/orders'] = {
    post: {
      operationId: 'createOrder',
      responses: { '201': { description: 'Created' } },
    },
  };
  paths['/legacy'] = {
    get: {
      operationId: 'legacy',
      responses: { '200': { description: 'Nothing serves this' } },
    },
  };

  return base;
}

let running: INestApplication | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/**
 * Boots an application, listening on a port the operating system picks.
 *
 * @param platform - Which adapter to boot on
 * @param moduleClass - The host module, which imports whatever the test is about
 * @returns The base url
 */
async function boot(platform: (typeof PLATFORMS)[number], moduleClass: unknown): Promise<string> {
  const app =
    platform === 'fastify'
      ? await (async (): Promise<INestApplication> => {
          const { FastifyAdapter } = await import('@nestjs/platform-fastify');
          return NestFactory.create(moduleClass as never, new FastifyAdapter(), {
            logger: false,
            abortOnError: false,
          });
        })()
      : await NestFactory.create(moduleClass as never, { logger: false, abortOnError: false });

  running = app;
  await app.listen(0, '127.0.0.1');

  return app.getUrl();
}

/**
 * The provider `forRoot` registered, read back out of the container.
 *
 * @returns The mounted references
 */
function references(): MountedReferences {
  const resolved = running?.get(OPENREF_REFERENCES, { strict: false });
  if (!(resolved instanceof MountedReferences)) throw new Error('forRoot registered no provider');

  return resolved;
}

for (const platform of PLATFORMS) {
  describe(`forRoot mounting its own documents on ${platform}`, () => {
    @Module({
      controllers: [OrdersController],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            { id: 'public', route: '/docs', document: document(), assetPlan: assetPlan() },
          ],
          runtime: { collectors: [scopesCollector], sourceLink: 'https://host/{file}#L{line}' },
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class AppModule {}

    it('should serve the route table it mounted', async () => {
      // Given
      const url = await boot(platform, AppModule);

      // When
      const statuses = await Promise.all(
        ['/docs', '/docs/openapi.json', '/docs/health', '/docs/_search-index'].map(
          async (path) => (await fetch(`${url}${path}`)).status,
        ),
      );

      // Then
      expect(statuses).toEqual([200, 200, 200, 200]);
    });

    it('should attach a fact to every operation the application actually serves', async () => {
      // Given
      await boot(platform, AppModule);

      // When
      const mounted = references().get('public');
      const withFacts = [...(mounted?.pass.document.nodes.values() ?? [])].filter(
        (node) => node.runtime !== undefined,
      );

      // Then, two of the three operations have a handler and the third is reported
      expect(withFacts).toHaveLength(2);
      expect(mounted?.pass.pairing.nodesWithoutRoute.map((problem) => problem.subject)).toEqual([
        expect.stringContaining('legacy') as unknown as string,
      ]);
    });

    it('should record the source link template and the framework version in the meta', async () => {
      // Given
      await boot(platform, AppModule);

      // When
      const meta = references().get('public')?.pass.document.runtime;

      // Then
      expect(meta?.collectors).toEqual(['scopesCollector']);
      expect(meta?.sourceLinkTemplate).toBe('https://host/{file}#L{line}');
      expect(meta?.nestVersion).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe(`setup picking the pass up from forRoot on ${platform}`, () => {
    @Module({
      controllers: [OrdersController],
      imports: [OpenRefModule.forRoot({ runtime: { collectors: [scopesCollector] } })],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class RuntimeOnlyModule {}

    it('should collect facts for a document setup mounts afterwards', async () => {
      // Given, the flow every NestJS application already has: the document cannot exist until
      // after the application does, so forRoot carries the runtime and setup carries the document
      const app = await NestFactory.create(RuntimeOnlyModule, {
        logger: false,
        abortOnError: false,
      });
      running = app;

      // When
      const service = OpenRefModule.setup('/docs', app, {
        document: document(),
        assetPlan: assetPlan(),
      });
      await app.listen(0, '127.0.0.1');

      // Then
      const withFacts = [...service.document.nodes.values()].filter(
        (node) => node.runtime !== undefined,
      );
      expect(withFacts).toHaveLength(2);
      expect((await fetch(`${await app.getUrl()}/docs/openapi.json`)).status).toBe(200);
    });

    it('should record what setup mounted, so both entry points answer for one process', async () => {
      // Given
      const app = await NestFactory.create(RuntimeOnlyModule, {
        logger: false,
        abortOnError: false,
      });
      running = app;
      OpenRefModule.setup('/docs', app, { document: document(), assetPlan: assetPlan() });
      await app.listen(0, '127.0.0.1');

      // Then
      expect(
        references()
          .all()
          .map((mounted) => mounted.id),
      ).toEqual(['/docs']);
    });
  });
}

/**
 * SPEC 13.1 with nothing else in the application, on both boots.
 *
 * WHAT THIS PAIR CAN AND CANNOT DELIVER, STATED EXACTLY, BECAUSE THE FIRST WORDING OVERCLAIMED.
 * Until 2026-09-01 the only case here passed `abortOnError: false`, which switches off the
 * mechanism a reader meets: `NestFactory.create` returns a proxy that runs every call through
 * `ExceptionsZone`, and with the default the zone ends the process instead of rethrowing. `setup`
 * asked the container a question whose throw it was catching, the catch never ran, and a reader's
 * process exited 1 with no output while this file stayed green.
 *
 * ADDING A DEFAULT BOOT DOES NOT FIX THAT ON ITS OWN, AND THE CLAIM THAT IT DID WAS WRONG.
 * Measured on 2026-09-01: with the production fix reverted, this whole file is 20 of 20 green,
 * because inside a vitest worker the `process.exit(1)` in question does not end the run. So
 * neither case below can see the defect, and the proof that a reader's own boot survives is
 * `packages/nest/test/integration/first-minute.spec.ts`, which spawns a child and reads its exit
 * code. Reverted, that child exits 1 with nothing on either stream.
 *
 * WHAT THE PAIR DOES DELIVER is that `setup` without `forRoot` mounts and serves under both boot
 * options, so a host who sets neither and a host who sets `abortOnError: false` get the same
 * answer. That is worth having and it is all it is.
 *
 * THE FOUR OTHER USES OF `abortOnError: false` IN THIS FILE ARE THE HARNESS'S, not a claim about
 * boot options: the `platforms` helper and the two `forRootAsync` cases set it so that a
 * misconfiguration under test surfaces as a rejected promise the case can assert on, rather than
 * as a killed worker with no message.
 */
describe('setup with no forRoot at all, which is SPEC 13.1 unchanged', () => {
  @Module({ controllers: [OrdersController] })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class PlainModule {}

  it('should mount and serve on a default boot, which is how a reader boots', async () => {
    // Given the options SPEC 2's first minute implies: none
    const app = await NestFactory.create(PlainModule, { logger: false });
    running = app;

    // When
    const service = OpenRefModule.setup('/docs', app, {
      document: document(),
      assetPlan: assetPlan(),
    });
    await app.listen(0, '127.0.0.1');

    // Then
    expect(service.document.runtime).toBeUndefined();
    expect([...service.document.nodes.values()].every((node) => node.runtime === undefined)).toBe(
      true,
    );
    expect((await fetch(`${await app.getUrl()}/docs`)).status).toBe(200);
  });

  it('should mount and serve when the framework rethrows instead of aborting', async () => {
    // Given the boot every other case in this file uses, which is the other half of the pair
    const app = await NestFactory.create(PlainModule, { logger: false, abortOnError: false });
    running = app;

    // When
    const service = OpenRefModule.setup('/docs', app, {
      document: document(),
      assetPlan: assetPlan(),
    });
    await app.listen(0, '127.0.0.1');

    // Then
    expect(service.document.runtime).toBeUndefined();
    expect((await fetch(`${await app.getUrl()}/docs`)).status).toBe(200);
  });
});

describe('forRootAsync', () => {
  // A configuration module written the way a host writes one: the provider is exported, and the
  // factory's `imports` is how it reaches a provider that lives outside the dynamic module. That
  // is the NestJS rule for every `forRootAsync`, and a test that declared the provider beside the
  // import would have been testing a mistake rather than the feature.
  @Module({
    providers: [{ provide: 'CONFIG', useValue: { route: '/reference' } }],
    exports: ['CONFIG'],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class ConfigModule {}

  @Module({
    controllers: [OrdersController],
    imports: [
      OpenRefModule.forRootAsync({
        imports: [ConfigModule],
        inject: ['CONFIG'],
        useFactory: (config: { route: string }) => ({
          documents: [
            { id: 'public', route: config.route, document: document(), assetPlan: assetPlan() },
          ],
          runtime: { collectors: [scopesCollector] },
        }),
      }),
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class AsyncModule {}

  it('should mount on the route its factory decided, with the host injection first', async () => {
    // Given, the host's own injections come before the framework ones, so adding a dependency
    // to the pass can never shift the positions a host's factory reads
    const url = await boot('express', AsyncModule);

    // When
    const status = (await fetch(`${url}/reference/openapi.json`)).status;

    // Then
    expect(status).toBe(200);
    expect(references().get('public')?.basePath).toBe('/reference');
  });
});

describe('the pass runs once, at bootstrap', () => {
  @Module({
    controllers: [OrdersController],
    imports: [
      OpenRefModule.forRoot({
        documents: [{ id: 'public', route: '/docs', document: document(), assetPlan: assetPlan() }],
        runtime: { collectors: [scopesCollector] },
      }),
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class AppModule {}

  it('should not walk the container again when the hook is called twice', async () => {
    // Given, a module imported twice would otherwise register the route table twice and mount a
    // second reference, and a pass rerun per request would be a denial of service written by us
    await boot('express', AppModule);
    const mounted = references().get('public');

    // When
    references().onModuleInit();

    // Then, the same object, not a rebuilt one
    expect(references().get('public')).toBe(mounted);
    expect(references().all()).toHaveLength(1);
  });

  it('should answer many requests without collecting anything again', async () => {
    // Given
    const url = await boot('express', AppModule);
    const before = references().get('public')?.pass;

    // When
    await Promise.all([1, 2, 3, 4, 5].map(async () => fetch(`${url}/docs`)));

    // Then
    expect(references().get('public')?.pass).toBe(before);
  });
});

describe('the route table forRoot registers, which used to drop the method', () => {
  // Found by TX-VIS while putting the admission in front of the same loop. `setup` read `method`
  // off the table and this path did not, so the one route in the table that is not a GET, the
  // proxy of SPEC 14.5, was registered as a GET: the POST a page sends reached nothing at all.
  @Module({
    controllers: [OrdersController],
    imports: [
      OpenRefModule.forRoot({
        documents: [
          {
            id: 'public',
            route: '/docs',
            document: document(),
            assetPlan: assetPlan(),
            proxy: { enabled: true },
          },
        ],
      }),
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class ProxyModule {}

  it('should answer the proxy on POST and not on GET', async () => {
    // Given
    const url = await boot('express', ProxyModule);

    // When
    const asGet = await fetch(`${url}/docs/_proxy`);
    const asPost = await fetch(`${url}/docs/_proxy`, { method: 'POST', body: '{}' });

    // Then
    expect(asGet.status).toBe(404);
    expect(asPost.status).toBe(403);
  });

  it('should carry the proxy option a documents entry set, which nothing used to read', async () => {
    // Given, `documents` entries are setup options plus an id and a route, so `proxy` was accepted
    // here and read by nobody: a host that turned the proxy on got the permanent 403 of one that
    // is off, which is a configured feature doing nothing with no error anywhere
    const url = await boot('express', ProxyModule);

    // When
    const refusal = await (
      await fetch(`${url}/docs/_proxy`, { method: 'POST', body: '{}' })
    ).json();

    // Then, the refusal is the one an enabled proxy gives a body it cannot read
    expect(JSON.stringify(refusal)).toContain('envelope');
    expect(JSON.stringify(refusal)).not.toContain('not enabled');
  });
});

describe('the health route, which the runtime option gates', () => {
  @Module({
    controllers: [OrdersController],
    imports: [
      OpenRefModule.forRoot({
        documents: [{ id: 'public', route: '/docs', document: document(), assetPlan: assetPlan() }],
        runtime: { health: false },
      }),
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class NoHealthModule {}

  it('should not answer when health is off, while the rest of the table still does', async () => {
    // Given
    const url = await boot('express', NoHealthModule);

    // When
    const health = await fetch(`${url}/docs/health`);
    const overview = await fetch(`${url}/docs`);

    // Then
    expect(health.status).toBe(404);
    expect(overview.status).toBe(200);
  });
});

describe('the federation forRoot mounts, per SPEC 15.3', () => {
  @Module({
    controllers: [OrdersController],
    imports: [
      OpenRefModule.forRoot({
        documents: [{ id: 'public', route: '/docs', document: document(), assetPlan: assetPlan() }],
        runtime: { collectors: [scopesCollector] },
        federation: {
          route: '/federated',
          id: 'gateway',
          assetPlan: assetPlan(),
          services: [{ id: 'public' }],
          // A remote nobody answers: the local service must be served while it fails, which
          // is the degrade principle at second zero.
          remotes: [{ id: 'ghost', url: 'http://127.0.0.1:9/openapi.json' }],
          refreshMs: 60_000,
          timeoutMs: 500,
        },
      }),
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class FederatedModule {}

  it('should serve the local composition while the remote fails, visibly', async () => {
    // Given
    const url = await boot('express', FederatedModule);

    // When: the local document is served at once
    const overview = await fetch(`${url}/federated`);
    const html = await overview.text();

    // Then: the local service is on the page with its runtime facts merged in
    expect(overview.status).toBe(200);
    expect(html).toContain('data-oref-service="public"');

    // And the live snapshot names the ghost as the remote it is, absent version and all,
    // while the local service appears only as document data, which is what says local
    const snapshot = (await (await fetch(`${url}/federated/_federation`)).json()) as {
      availability: string;
      remotes: readonly { id: string; status: string }[];
    };
    expect(snapshot.availability).toBe('ready');
    expect(snapshot.remotes.map((remote) => remote.id)).toEqual(['ghost']);
    expect(['pending', 'failed']).toContain(snapshot.remotes[0]?.status ?? '');

    // And the plain mount still answers untouched beside it
    expect((await fetch(`${url}/docs`)).status).toBe(200);
  });

  it('should carry the local service runtime facts into the federated card', async () => {
    // Given
    const url = await boot('express', FederatedModule);

    // When
    const card = await fetch(`${url}/federated/service/public`);
    const html = await card.text();

    // Then: the collectors that really ran on this process's own document
    expect(card.status).toBe(200);
    expect(html).toContain('scopesCollector');
  });
});

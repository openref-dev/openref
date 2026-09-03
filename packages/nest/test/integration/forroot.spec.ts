import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InvalidOptionsError } from '@openref/core';
import { nodeHref } from '@openref/render';
import type { INestApplication } from '@nestjs/common';
import { OpenRefModule } from '../../src/api/openref.module';
import { MountedReferences } from '../../src/api/mounted-references';
import { NODE_PARAM, referenceRoutes } from '../../src/reference/domain/routes';
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
 * Creates an application on one adapter, not yet listening and not yet initialized.
 *
 * @param platform - Which adapter to boot on
 * @param moduleClass - The host module, which imports whatever the test is about
 * @returns The application
 */
async function create(
  platform: (typeof PLATFORMS)[number],
  moduleClass: unknown,
): Promise<INestApplication> {
  if (platform === 'fastify') {
    const { FastifyAdapter } = await import('@nestjs/platform-fastify');
    return NestFactory.create(moduleClass as never, new FastifyAdapter(), {
      logger: false,
      abortOnError: false,
    });
  }

  return NestFactory.create(moduleClass as never, { logger: false, abortOnError: false });
}

/**
 * Boots an application, listening on a port the operating system picks.
 *
 * @param platform - Which adapter to boot on
 * @param moduleClass - The host module, which imports whatever the test is about
 * @returns The base url
 */
async function boot(platform: (typeof PLATFORMS)[number], moduleClass: unknown): Promise<string> {
  const app = await create(platform, moduleClass);

  running = app;
  await app.listen(0, '127.0.0.1');

  return app.getUrl();
}

/**
 * A second document, whose whole point is the mount point it is served on.
 *
 * @returns A document distinguishable from `document()` by its title
 */
function nestedDocument(): Record<string, unknown> {
  const base = specification();
  (base.info as Record<string, unknown>).title = 'Nested';

  return base;
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

  /**
   * SPEC 13.2's "the two entry points add up", which was a sentence and not a behaviour.
   *
   * TWO DEFECTS OF `@openref/nest`, BOTH MEASURED ON THE BUILT `examples/events` ON 2026-09-03 AND
   * BOTH FIXED AT `T065`. `setup` records its mount through `MountedReferences.record`, and
   * `onModuleInit` returned early on `this.mounted.size > 0`, an idempotence guard written against
   * a module imported twice and reading a map the other entry point writes; so an application
   * calling `forRoot({ documents })` and `setup` before `listen` mounted none of its `documents`.
   * And with that guard defeated, `setup` still registered `/docs/:nodeId` before `onModuleInit`
   * registered `/docs/events`, so on Express the nested mount was answered by the parameter with
   * `No operation of that name is documented here.` about an address that exists.
   *
   * THE NESTED DOCUMENT IS HANDED RATHER THAN SYNTHESIZED, deliberately. `kind: 'events'` is the
   * shape the example needed and this is about every route the module registers: what is under
   * test is that a mount may nest inside another mount, whatever document it serves.
   */
  describe(`forRoot documents and setup on one application on ${platform}`, () => {
    @Module({
      controllers: [OrdersController],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'events',
              route: '/docs/events',
              document: nestedDocument(),
              assetPlan: assetPlan(),
            },
          ],
          runtime: { collectors: [scopesCollector] },
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class BothEntryPointsModule {}

    /**
     * Boots the shape `examples/events` has: `forRoot` documents, then `setup`, then `listen`.
     *
     * @returns The base url
     */
    async function bootBoth(): Promise<string> {
      const app = await create(platform, BothEntryPointsModule);

      running = app;
      OpenRefModule.setup('/docs', app, { document: document(), assetPlan: assetPlan() });
      await app.listen(0, '127.0.0.1');

      return app.getUrl();
    }

    it('should mount both documents rather than skipping the whole documents list', async () => {
      // Given
      await bootBoth();

      // When
      const mounted = references()
        .all()
        .map((entry) => entry.id)
        .sort();

      // Then
      expect(mounted).toEqual(['/docs', 'events']);
    });

    it('should serve the nested mount rather than answering it with the node parameter', async () => {
      // Given
      const url = await bootBoth();

      // When
      const page = await fetch(`${url}/docs/events`);
      const body = await page.text();

      // Then, the nested reference's own overview and not the outer mount's 404 with words
      expect(page.status).toBe(200);
      expect(body).not.toContain('No operation of that name is documented here.');
      expect(body).toContain('Nested');
    });

    it('should keep every address of both mounts reachable', async () => {
      // Given
      const url = await bootBoth();

      // When
      const statuses = await Promise.all(
        [
          '/docs',
          '/docs/openapi.json',
          '/docs/health',
          '/docs/events',
          '/docs/events/openapi.json',
          '/docs/events/health',
        ].map(async (path) => (await fetch(`${url}${path}`)).status),
      );

      // Then
      expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
    });

    it('should answer the outer node page, which is what the deferral must not have cost', async () => {
      // Given
      const url = await bootBoth();

      // When
      const page = await fetch(`${url}/docs/post-orders`);
      const absent = await fetch(`${url}/docs/no-such-node`);

      // Then the parameter still answers, and still says so when the id names nothing
      expect(page.status).toBe(200);
      expect(absent.status).toBe(404);
      expect(await absent.text()).toContain('No operation of that name is documented here.');
    });

    /**
     * The committed sweep of every route of the table, which the six addresses above do not make.
     *
     * SIX ADDRESSES ARE NOT TWENTY FIVE. This walks every pattern `referenceRoutes` produces except
     * the node page itself, on its declared method, on each of the two mounts: 50 addresses, and
     * none of them may be answered by the node page. The patterns are read off the table rather
     * than written again here, so a route added to SPEC 13.3 is swept the day it is registered.
     *
     * `:nodeId` IS FILLED WITH A REAL NODE OF THAT MOUNT AND THE OTHER PARAMETERS ARE NOT, and the
     * difference is what the assertion can tell apart. The bench route answers a missing node with
     * the same sentence the node page uses, so a made up id there would look exactly like the
     * defect; every other route answers a name it does not know in its own words. So bench gets a
     * node that exists and the rest get a literal.
     */
    it('should answer all 50 addresses of both mounts from their own routes', async () => {
      // Given
      const url = await bootBoth();
      const nodeOf = (mountId: string): string =>
        [...(references().get(mountId)?.service.document.nodes.keys() ?? [])][0] ?? 'none';

      // When, every pattern of the table except the node page, on each mount, on its own method
      const swept = await Promise.all(
        (
          [
            ['/docs', nodeOf('/docs')],
            ['/docs/events', nodeOf('events')],
          ] as const
        ).flatMap(([mount, node]) =>
          referenceRoutes(mount)
            .filter((route) => route.id !== 'node')
            .map(async (route) => {
              const at = route.pattern
                .replace(`:${NODE_PARAM}`, node)
                .replaceAll(/:[A-Za-z]+/g, 'a-name-this-mount-does-not-know');
              const answered = await fetch(`${url}${at}`, { method: route.method.toUpperCase() });

              return { at, id: route.id, body: await answered.text() };
            }),
        ),
      );

      // Then not one of the 50 is answered by the node page
      const asNode = swept
        .filter((row) => row.body.includes('No operation of that name is documented here.'))
        .map((row) => `${row.id} ${row.at}`);
      expect(asNode).toEqual([]);
      expect(swept).toHaveLength(50);
    });

    /**
     * The other half of SPEC 13.3's rule: no route of the table answers through `:nodeId`.
     *
     * `_proxy` is the one route whose method is not `GET`, so a `GET` to it matched nothing until
     * the parameter and was told that no operation of that name is documented, about an address
     * that exists. That is the sentence the second `mcp` registration exists to prevent.
     */
    it('should answer a GET on the proxy address as the proxy and not as a missing node', async () => {
      // Given
      const url = await bootBoth();

      // When
      const answered = await fetch(`${url}/docs/_proxy`);
      const body = await answered.text();

      // Then
      expect(body).not.toContain('No operation of that name is documented here.');
      expect(answered.status).not.toBe(404);
    });
  });

  /**
   * The third direction of SPEC 13.3's rule, and the one that is a refusal rather than an order.
   *
   * MEASURED BEFORE THE REFUSAL EXISTED, on both adapters, 2026-09-03. With `route: '/docs/health'`
   * configured beside `setup('/docs')`, express answered 200 at `/docs/health` from the enclosing
   * Documentation Health page and 200 at `/docs/health/openapi.json` from the nested mount, so that
   * mount silently lost its overview; fastify threw `FastifyError: Method 'GET' already declared
   * for route '/docs/health'` from inside `onModuleInit`. One configuration, two behaviours, and
   * neither of them a refusal. Both sides are static, so no registration order fixes it.
   *
   * THE SUBJECT IS ASSERTED PRESENT BY THE DESCRIBE ABOVE, which mounts `/docs/events` beside
   * `/docs` and serves both: a refusal that also swallowed the legal nesting would redden there.
   */
  describe(`a mount whose address is a named route of an enclosing mount on ${platform}`, () => {
    @Module({
      controllers: [OrdersController],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'collides',
              route: '/docs/health',
              document: nestedDocument(),
              assetPlan: assetPlan(),
            },
          ],
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class CollidingModule {}

    it('should refuse at configuration, naming both mounts and the route', async () => {
      // Given the shape that used to differ per adapter
      const app = await create(platform, CollidingModule);
      running = app;

      // When, and the refusal lands here rather than at `listen`: `setup` asks the provider about
      // the `documents` a host configured, so the pair is known before either is registered
      const act = (): unknown =>
        OpenRefModule.setup('/docs', app, { document: document(), assetPlan: assetPlan() });

      // Then the same refusal on both adapters, naming both mounts and the colliding route
      expect(act).toThrow(InvalidOptionsError);
      expect(act).toThrow(/"collides"/);
      expect(act).toThrow(/"\/docs\/health"/);
      expect(act).toThrow(/"\/docs"/);
    });

    it('should refuse the same collision when setup is the second of the two', async () => {
      // Given the other order: the enclosing mount configured, the nested one set up
      @Module({
        controllers: [OrdersController],
        imports: [
          OpenRefModule.forRoot({
            documents: [
              { id: 'outer', route: '/docs', document: document(), assetPlan: assetPlan() },
            ],
          }),
        ],
      })
      // eslint-disable-next-line @typescript-eslint/no-extraneous-class
      class OuterModule {}

      const app = await create(platform, OuterModule);
      running = app;

      // When
      const act = (): unknown =>
        OpenRefModule.setup('/docs/health', app, {
          document: nestedDocument(),
          assetPlan: assetPlan(),
        });

      // Then it is refused before anything is built, rather than at the hook
      expect(act).toThrow(InvalidOptionsError);
      expect(act).toThrow(/"outer"/);
    });
  });

  /**
   * `setup` after `app.init()`, which one adapter supports and the other cannot.
   *
   * MEASURED ON BOTH, 2026-09-03, BEFORE ANYTHING WAS DECIDED. With `init` awaited first, express
   * answered 404 on the overview, on `openapi.json`, on the health page and on the node page
   * alike, because `init` registers NestJS's own not found handler and express matches in
   * registration order; fastify answered 200 on all four, because it ranks routes and accepts
   * registrations until `listen`. So the answer is a refusal naming express rather than a fix on
   * both: getting ahead of that handler means reordering the host's own middleware stack, which is
   * a larger promise than SPEC 13.1 makes.
   *
   * IT IS ALSO WHAT MAKES `deferNodeRoute`'s FALSE BRANCH REACHABLE AND TESTED. That branch is
   * `setup` running after the hook, which is exactly this path, and until now nothing exercised it
   * on either adapter while its documentation described it as working.
   */
  describe(`setup after app.init() on ${platform}`, () => {
    @Module({
      controllers: [OrdersController],
      imports: [OpenRefModule.forRoot({ runtime: { collectors: [scopesCollector] } })],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class RuntimeOnlyModule {}

    @Module({
      controllers: [OrdersController],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'events',
              route: '/docs/events',
              document: nestedDocument(),
              assetPlan: assetPlan(),
            },
          ],
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class WithDocumentsModule {}

    it('should refuse on express by name, and mount and serve on fastify', async () => {
      // Given an application that has already been initialized
      const app = await create(platform, RuntimeOnlyModule);
      running = app;
      await app.init();

      // When
      const act = (): unknown =>
        OpenRefModule.setup('/docs', app, { document: document(), assetPlan: assetPlan() });

      // Then
      if (platform === 'express') {
        expect(act).toThrow(InvalidOptionsError);
        expect(act).toThrow(/after the application was initialized/);
        expect(act).toThrow(/express/);
        return;
      }

      act();
      await app.listen(0, '127.0.0.1');
      const url = await app.getUrl();
      const statuses = await Promise.all(
        ['/docs', '/docs/openapi.json', '/docs/health', '/docs/get-orders-id'].map(
          async (path) => (await fetch(`${url}${path}`)).status,
        ),
      );

      // And the node page among them, which is the deferral's false branch having registered it
      expect(statuses).toEqual([200, 200, 200, 200]);
    });

    /**
     * The shape the case above cannot reach, and the regression it hid.
     *
     * `forRoot({ runtime })` CARRIES NO `documents`, so the collision check saw one mount and could
     * not double count. With `documents` it did: `mount` files each configured entry into
     * `MountedReferences.mounted` under the id the options carry, and `addresses` concatenated the
     * map with the options mapped again, so after the hook every configured mount was compared with
     * itself. A blind review measured it on this exact shape: `setup` on an initialized fastify
     * application refused with "the reference `events` mounted on `/docs/events` answers
     * `/docs/events`, which the reference `events` mounted on `/docs/events` also answers".
     */
    it('should not refuse a mount for colliding with itself when documents are configured', async () => {
      // Given the shape with `documents`, which is the one the case above cannot express
      const app = await create(platform, WithDocumentsModule);
      running = app;
      await app.init();

      // When
      const act = (): unknown =>
        OpenRefModule.setup('/docs', app, { document: document(), assetPlan: assetPlan() });

      // Then express still refuses for the reason it always did, and fastify mounts and serves
      if (platform === 'express') {
        expect(act).toThrow(/after the application was initialized/);
        return;
      }

      act();
      await app.listen(0, '127.0.0.1');
      const url = await app.getUrl();
      const statuses = await Promise.all(
        ['/docs', '/docs/events', '/docs/events/openapi.json'].map(
          async (path) => (await fetch(`${url}${path}`)).status,
        ),
      );
      expect(statuses).toEqual([200, 200, 200]);
    });

    @Module({
      controllers: [OrdersController],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            { id: 'public', route: '/docs', document: document(), assetPlan: assetPlan() },
          ],
          federation: { id: 'all', route: '/federated', services: [{ id: 'public' }] },
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class FederatedRootModule {}

    /**
     * The federated mount, which the collision check went blind to for exactly one round.
     *
     * THE FEDERATION IS FILED NOWHERE IN `mounted`, so a `federatedService !== undefined` guard on
     * reading it out of the options prevented no double count and only blinded the check once the
     * hook had run. Measured on fastify, where `setup` after `app.init()` is supported:
     * `setup('/federated/health')` was refused by name before `init` and passed after it, leaving
     * fastify to throw its own "Method 'GET' already declared for route '/federated/health'" from
     * inside `setup`. That is the divergence the refusal replaces, on the path this same round
     * created, which is why the case runs on both sides of `init`.
     */
    it('should refuse a mount colliding with the federation, before and after init alike', async () => {
      // Given
      const app = await create(platform, FederatedRootModule);
      running = app;
      const mount = (): unknown =>
        OpenRefModule.setup('/federated/health', app, {
          document: nestedDocument(),
          assetPlan: assetPlan(),
        });

      // Then before `init`, on both adapters, the refusal names the federation
      expect(mount).toThrow(InvalidOptionsError);
      expect(mount).toThrow(/"all"/);

      // And after `init`, which is where fastify used to be left to throw its own error
      await app.init();
      expect(mount).toThrow(InvalidOptionsError);
      if (platform === 'fastify') expect(mount).toThrow(/"all"/);
    });
  });

  /**
   * A node id equal to a reserved name, which OpenAPI 3.2 lets a document write.
   *
   * MEASURED BEFORE THE ESCAPE EXISTED, on both adapters: `/docs/_search-index` answered the search
   * index JSON and the node's own page was unreachable, so a legal document lost a page in silence.
   * `additionalOperations` is the member 3.2 added for methods outside the nine, so `_search` on
   * `/index` is not an abuse of the format, it is the format.
   */
  describe(`a node id that collides with a reserved name on ${platform}`, () => {
    /** The legal 3.2 document whose only operation is named `_search-index` by derivation. */
    function collidingDocument(): Record<string, unknown> {
      return {
        openapi: '3.2.0',
        info: { title: 'Colliding', version: '1.0.0' },
        paths: {
          '/index': {
            additionalOperations: {
              _search: {
                summary: 'The node that wants a reserved name',
                responses: { '200': { description: 'ok' } },
              },
            },
          },
        },
      };
    }

    @Module({ controllers: [OrdersController] })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class PlainModule {}

    it('should keep both the route and the node page reachable', async () => {
      // Given
      const app = await create(platform, PlainModule);
      running = app;
      const service = OpenRefModule.setup('/docs', app, {
        document: collidingDocument(),
        assetPlan: assetPlan(),
      });
      await app.listen(0, '127.0.0.1');
      const url = await app.getUrl();

      // When, the subject asserted present first: the document really did claim the name
      expect([...service.document.nodes.keys()]).toEqual(['_search-index']);

      const route = await fetch(`${url}/docs/_search-index`);
      const node = await fetch(`${url}/docs/_u005f_search-index`);
      const [fromRoute, fromNode] = await Promise.all([route.text(), node.text()]);

      // Then the route answers its own payload and the node answers its own page
      expect(route.status).toBe(200);
      expect(route.headers.get('content-type')).toContain('application/json');
      expect(fromRoute).toContain('"documentHash"');
      expect(node.status).toBe(200);
      expect(fromNode).toContain('The node that wants a reserved name');
    });

    /**
     * The half an escape can get wrong in the other direction: a link nobody serves.
     *
     * `nodeHref` IS THE FUNCTION THE BROWSER CALLS, not a transcription of it. The command palette
     * and the navigation tree build every node link with it at runtime, and the served page carries
     * ids rather than hrefs, so the escape has to be right in the shipped bundle and on the server
     * at once. Fetching exactly what that function returns is the only assertion that ties the two.
     */
    it('should serve the address the renderer links a node at', async () => {
      // Given, because a page that is reachable at an address nothing links is reachable by nobody
      const app = await create(platform, PlainModule);
      running = app;
      const service = OpenRefModule.setup('/docs', app, {
        document: collidingDocument(),
        assetPlan: assetPlan(),
      });
      await app.listen(0, '127.0.0.1');
      const url = await app.getUrl();

      // When, the href the browser would build for that node
      const [nodeId] = [...service.document.nodes.keys()];
      const href = nodeHref(nodeId ?? '', '/docs');
      const answered = await fetch(`${url}${href}`);

      // Then it is the escaped address, and the server serves it
      expect(href).toBe('/docs/_u005f_search-index');
      expect(answered.status).toBe(200);
      expect(await answered.text()).toContain('The node that wants a reserved name');
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

  /**
   * THE `GET` ANSWERED 404 UNTIL `T065` AND THAT WAS THE PARAMETER, NOT THIS ROUTE. `_proxy` is
   * registered on both methods now, per SPEC 13.3, by the `mcp` precedent: a `GET` fell through to
   * `/docs/:nodeId` and was told that no operation of that name is documented, about an address
   * that exists. The original subject of this case survives unchanged, because a path that drops
   * `method` and registers everything as a `GET` leaves the `POST` matching no route at all, which
   * is the framework's own 404 rather than the proxy's refusal.
   */
  it('should answer the proxy on both methods, each about what it was given', async () => {
    // Given
    const url = await boot('express', ProxyModule);

    // When
    const asGet = await fetch(`${url}/docs/_proxy`);
    const asPost = await fetch(`${url}/docs/_proxy`, {
      method: 'POST',
      body: JSON.stringify({ method: 'GET', url: 'https://elsewhere.example.com/' }),
    });
    const [fromGet, fromPost] = await Promise.all([asGet.text(), asPost.text()]);

    // Then both are the proxy's own refusal and neither is the node page's
    expect(asGet.status).toBe(403);
    expect(asPost.status).toBe(403);
    expect(fromGet).toContain('not a proxy envelope');
    expect(fromPost).not.toContain('not a proxy envelope');
    expect(fromGet).not.toContain('No operation of that name is documented here.');
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

import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, Get, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { OpenRefModule } from '../../src/api/openref.module';
import { referenceRoutes } from '../../src/reference/domain/routes';
import { REFUSED_BODY } from '../../src/visibility/domain/admission';
import { assetPlan, specification } from '../mocks/fixtures';

/**
 * SPEC 19.6 against real NestJS applications, on both adapters.
 *
 * WHAT ONLY THIS FILE CAN PROVE, AND WHY IT HAS TO PROVE IT TWICE. The routes of SPEC 13.3 are
 * registered on the http adapter directly, which is what keeps a documentation page out from
 * behind whatever the application applies globally and is exactly why NestJS never sees them: no
 * controller, no `@UseGuards`, no `APP_GUARD`. The guard is therefore resolved and called by this
 * package, on Express and on Fastify, through two adapters that write a reply in two different
 * ways. A guard that ran on one of them and not the other would be worse than no guard at all,
 * because the promise would read as kept.
 *
 * THE SWEEP IS DERIVED FROM THE TABLE RATHER THAN LISTED. Five of the addresses SPEC 13.3 names do
 * not exist until M5 and M6, so "every route of SPEC 13.3" can only be closed honestly as "every
 * route the mount loop registers". Reading `referenceRoutes` is what makes that true of the table
 * as it will be rather than as it is: a route added in a later milestone joins this sweep on the
 * day it joins the table, and nobody has to remember to add it here.
 *
 * THE NEGATIVE IS PROVED BEFORE THE POSITIVE. A sweep that finds every route refused proves
 * nothing on its own, because a route that does not exist is also not reachable. So the same sweep
 * runs first against a public mount, where every address has to answer.
 */

const PLATFORMS = ['express', 'fastify'] as const;

/** The credential the fixture guards check for, which exists only to be present or absent. */
const PASS = 'Bearer let-me-in';

@Controller('orders')
class OrdersController {
  @Get(':id')
  readOrder(): string {
    return 'an order';
  }
}

/**
 * The guard a host writes, reading the framework's own request out of the context.
 *
 * IT IS TYPED AS THE FRAMEWORK'S `CanActivate` ON PURPOSE. The option this is passed to is declared
 * in this package's own structural types, and the assignment below is the compile time half of the
 * proof: a real NestJS guard has to remain assignable to `GuardLike`, or a host cannot pass one.
 */
@Injectable()
class BearerDocsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();

    return request.headers?.authorization === PASS;
  }
}

/** The same decision, thrown rather than returned, which is how a 401 reaches a reader. */
@Injectable()
class ThrowingDocsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    if (request.headers?.authorization === PASS) return true;

    throw new UnauthorizedException('no credential');
  }
}

/** The document the reference serves. */
function document(): Record<string, unknown> {
  const base = specification();
  const paths = base.paths as Record<string, unknown>;

  paths['/orders/{id}'] = {
    get: { operationId: 'readOrder', responses: { '200': { description: 'An order' } } },
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
 * @param moduleClass - The host module
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

/** One address the sweep drives, with the method the table registered it on. */
interface Address {
  readonly method: 'get' | 'post';
  readonly path: string;
}

/**
 * Every route the mount loop registers, as an address a request can be sent to.
 *
 * A parameter is filled with a value that names nothing, deliberately: what is being measured is
 * whether the request reaches the route at all, and a route that answers 404 for an unknown node
 * has still answered.
 *
 * @param basePath - The mount point
 * @returns One address per registered route
 */
function addresses(basePath: string): readonly Address[] {
  return referenceRoutes(basePath).map((route) => ({
    method: route.method,
    path: route.pattern
      .replace(':asset', 'nothing.css')
      .replace(':nodeId', 'nothing')
      .replace(':schemaId', 'nothing')
      .replace(':documentHash', 'nothing')
      .replace(':serviceId', 'nothing'),
  }));
}

/** What one address answered. */
interface Answer {
  readonly path: string;
  readonly status: number;
  readonly refused: boolean;
}

/**
 * Drives every registered route once.
 *
 * @param url - Base url of the running application
 * @param basePath - The mount point
 * @param headers - Headers to send, which is where the credential goes
 * @returns One answer per address, in table order
 */
async function sweep(
  url: string,
  basePath: string,
  headers: Record<string, string> = {},
): Promise<readonly Answer[]> {
  const results: Answer[] = [];

  for (const address of addresses(basePath)) {
    const response = await fetch(`${url}${address.path}`, {
      method: address.method.toUpperCase(),
      headers,
      ...(address.method === 'post' ? { body: '{}' } : {}),
    });
    const body = await response.text();

    results.push({ path: address.path, status: response.status, refused: body === REFUSED_BODY });
  }

  return results;
}

for (const platform of PLATFORMS) {
  describe(`a public reference on ${platform}`, () => {
    @Module({
      controllers: [OrdersController],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            { id: 'public', route: '/docs', document: document(), assetPlan: assetPlan() },
          ],
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class PublicModule {}

    it('should answer on every route the mount loop registered, refusing nobody', async () => {
      // Given, the negative half of the proof: the sweep below has to be able to reach these
      // addresses, or finding them all refused later would prove only that they do not exist
      const url = await boot(platform, PublicModule);

      // When
      const answers = await sweep(url, '/docs');

      // Then
      expect(answers).not.toHaveLength(0);
      expect(answers.filter((answer) => answer.refused)).toEqual([]);
      expect(answers.filter((answer) => answer.status >= 500)).toEqual([]);
    });
  });

  describe(`a reference behind a guard on ${platform}`, () => {
    @Module({
      controllers: [OrdersController],
      providers: [BearerDocsGuard],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'admin',
              route: '/docs',
              document: document(),
              assetPlan: assetPlan(),
              visibility: 'internal',
              guard: BearerDocsGuard,
            },
          ],
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class GuardedModule {}

    it('should refuse every registered route to a request with no credential', async () => {
      // Given, SPEC 19.6: the refusal covers the whole route table and not only the pages, since
      // the specification, the search index, the navigation payload and the health report all
      // describe an API a public reader was not meant to see
      const url = await boot(platform, GuardedModule);

      // When
      const answers = await sweep(url, '/docs');

      // Then
      expect(answers.filter((answer) => !answer.refused)).toEqual([]);
      expect(new Set(answers.map((answer) => answer.status))).toEqual(new Set([403]));
    });

    it('should answer every registered route to a request the guard admits', async () => {
      // Given
      const url = await boot(platform, GuardedModule);

      // When
      const answers = await sweep(url, '/docs', { authorization: PASS });

      // Then
      expect(answers.filter((answer) => answer.refused)).toEqual([]);
      expect(answers.filter((answer) => answer.status >= 500)).toEqual([]);
    });

    it('should serve the pages and the machine answers alike once admitted', async () => {
      // Given, the four addresses SPEC 19.6 names by hand, so the sweep above cannot pass by
      // finding a table full of 404s. The sweep's own length is read off `referenceRoutes` and is
      // deliberately not written down here: a number in a comment is the thing that goes stale,
      // which is what these four sites were before T056 corrected them
      const url = await boot(platform, GuardedModule);
      const named = ['/docs', '/docs/openapi.json', '/docs/_search-index', '/docs/health'];

      // When
      const statuses = await Promise.all(
        named.map(
          async (path) =>
            (await fetch(`${url}${path}`, { headers: { authorization: PASS } })).status,
        ),
      );

      // Then
      expect(statuses).toEqual([200, 200, 200, 200]);
    });
  });

  describe(`setup mounting behind a guard on ${platform}`, () => {
    @Module({ controllers: [OrdersController], providers: [ThrowingDocsGuard] })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class SetupModule {}

    it('should carry the same pair, since the ordinary flow cannot use forRoot to mount', async () => {
      // Given, SPEC 13.2: a document built by `SwaggerModule` does not exist until after
      // `NestFactory.create` has returned, so a visibility that lived only on `documents` would
      // be a reference the ordinary NestJS application is unable to close
      const app =
        platform === 'fastify'
          ? await (async (): Promise<INestApplication> => {
              const { FastifyAdapter } = await import('@nestjs/platform-fastify');
              return NestFactory.create(SetupModule, new FastifyAdapter(), {
                logger: false,
                abortOnError: false,
              });
            })()
          : await NestFactory.create(SetupModule, { logger: false, abortOnError: false });
      running = app;

      OpenRefModule.setup('/docs', app, {
        document: document(),
        assetPlan: assetPlan(),
        visibility: 'partner',
        guard: ThrowingDocsGuard,
      });
      await app.listen(0, '127.0.0.1');
      const url = await app.getUrl();

      // When
      const refused = await sweep(url, '/docs');
      const admitted = await sweep(url, '/docs', { authorization: PASS });

      // Then, an exception carrying a status keeps it, so a missing credential is a 401 and not
      // the 403 a returned false produces
      expect(new Set(refused.map((answer) => answer.status))).toEqual(new Set([401]));
      expect(refused.filter((answer) => !answer.refused)).toEqual([]);
      expect(admitted.filter((answer) => answer.refused)).toEqual([]);
    });
  });
}

describe('what the guard is shown', () => {
  const seen: { type: string; handler: unknown; request: unknown }[] = [];

  @Injectable()
  class WatchingGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      seen.push({
        type: context.getType(),
        handler: context.getHandler(),
        request: context.switchToHttp().getRequest(),
      });

      return true;
    }
  }

  @Module({
    controllers: [OrdersController],
    providers: [WatchingGuard],
    imports: [
      OpenRefModule.forRoot({
        documents: [
          {
            id: 'watched',
            route: '/docs',
            document: document(),
            assetPlan: assetPlan(),
            visibility: 'internal',
            guard: WatchingGuard,
          },
        ],
      }),
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class WatchedModule {}

  it('should be the http context and the framework request the router produced', async () => {
    // Given
    seen.length = 0;
    const url = await boot('express', WatchedModule);

    // When
    await fetch(`${url}/docs/openapi.json`, { headers: { 'x-probe': 'yes' } });

    // Then
    expect(seen[0]?.type).toBe('http');
    expect(typeof seen[0]?.handler).toBe('function');
    expect(
      (seen[0]?.request as { headers?: Record<string, string> } | undefined)?.headers?.['x-probe'],
    ).toBe('yes');
  });
});

describe('a mount that cannot honour what it was asked for', () => {
  it('should refuse to boot when a non public visibility names no guard', () => {
    // Given, refused while `forRoot` is evaluated, before a container or a route table exists
    const act = (): unknown =>
      OpenRefModule.forRoot({
        documents: [{ id: 'admin', route: '/docs', document: document(), visibility: 'internal' }],
      });

    // Then
    expect(act).toThrow(/supplies no guard/);
  });

  it('should refuse to boot when the guard class is not a provider anywhere', async () => {
    // Given, a guard the container cannot resolve is a guard that would not run, and this package
    // does not construct one itself: see SPEC 19.6
    @Injectable()
    class UnregisteredGuard implements CanActivate {
      canActivate(): boolean {
        return false;
      }
    }

    @Module({
      controllers: [OrdersController],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'admin',
              route: '/docs',
              document: document(),
              assetPlan: assetPlan(),
              visibility: 'internal',
              guard: UnregisteredGuard,
            },
          ],
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class BrokenModule {}

    // When
    const act = async (): Promise<string> => boot('express', BrokenModule);

    // Then
    await expect(act()).rejects.toThrow(/UnregisteredGuard/);
  });
});

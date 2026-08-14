import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  Controller,
  createParamDecorator,
  Get,
  HttpCode,
  Injectable,
  Module,
  Query,
  RequestMethod,
  Scope,
  Sse,
  UseGuards,
  UsePipes,
  type ArgumentsHost,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_PIPE,
  DiscoveryModule,
  DiscoveryService,
  NestFactory,
} from '@nestjs/core';
import type { Observable } from 'rxjs';
import {
  NEST_CORE_VALUE_NAMES,
  NEST_CUSTOM_ROUTE_ARGS_MARKER,
  NEST_DEFAULT_SCOPE,
  NEST_ENHANCER_TOKENS,
  NEST_GUARD_METADATA,
  NEST_HTTP_CODE_METADATA,
  NEST_PIPES_METADATA,
  NEST_REQUEST_METHODS,
  NEST_ROUTE_ARGS_METADATA,
  NEST_ROUTE_METADATA,
  NEST_ROUTE_PARAMTYPES,
  NEST_SCOPE_OPTIONS_METADATA,
  NEST_SSE_METADATA,
} from '../../src/shared/types/nest-surface';
import { readGlobalGuards } from '../../src/runtime/domain/guards';
import {
  loadNestCore,
  nestCoreVersion,
} from '../../src/runtime/infrastructure/adapters/nest-core.adapter';

/**
 * The value half of the NestJS surface, asked of the installed framework rather than assumed.
 *
 * `shared/types/nest-surface.ts` already promised that the structural half is the whole coupling
 * and that a compatibility test reads it. TX-FORROOT added a value half: five names loaded from
 * `@nestjs/core`, four metadata keys since T019 added the guards one, and eight numbers of an
 * enum. All three kinds are the framework's
 * on-disk format rather than its documentation, so all three are checked here against the copy
 * that is installed, and against both majors by the compatibility matrix.
 *
 * THIS FILE IS ALLOWED TO IMPORT `@nestjs/common` AND `src` IS NOT. A test may use a
 * devDependency; the published package may not, and the reason is in `nest-core.adapter.ts`.
 */

/** The enhancer classes the container is asked about, one per family plus the scoped case. */
@Injectable()
class ReadonlyGuard {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class AuditGuard {
  canActivate(): boolean {
    return true;
  }
}

@Injectable({ scope: Scope.REQUEST })
class RequestScopedGuard {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class LoggingInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle();
  }
}

@Injectable()
class TrimPipe {
  transform(value: unknown): unknown {
    return value;
  }
}

@Injectable()
class EverythingFilter {
  catch(_exception: unknown, _host: ArgumentsHost): void {
    return undefined;
  }
}

describe('the five names loaded from @nestjs/core', () => {
  it('should all be exported by the installed framework', () => {
    // Given, the load itself only reports which are missing after the fact
    const exported = createRequire(import.meta.url)('@nestjs/core') as Record<string, unknown>;

    // When
    const missing = NEST_CORE_VALUE_NAMES.filter((name) => exported[name] === undefined);

    // Then
    expect(missing).toEqual([]);
  });

  it('should be what loadNestCore hands to the injector', () => {
    // When
    const loaded = loadNestCore();

    // Then, each is a class, which is what a DI token has to be for `inject` to resolve it
    expect(Object.keys(loaded).sort()).toEqual([...NEST_CORE_VALUE_NAMES].sort());
    expect(Object.values(loaded).every((token) => typeof token === 'function')).toBe(true);
  });

  it('should be cached, because a host may declare several documents', () => {
    // When
    const first = loadNestCore();
    const second = loadNestCore();

    // Then
    expect(second).toBe(first);
  });

  it('should read the version of the copy it loaded from', () => {
    // When
    const version = nestCoreVersion();

    // Then
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('the metadata keys the discovery pass reads', () => {
  it('should be where @Controller and @Get write, on the real decorators', () => {
    // Given, the keys are string literals in this package rather than imported constants
    @Controller('orders')
    class OrdersController {
      @Get(':id')
      findOne(): string {
        return 'one';
      }
    }

    // When
    const controllerPath = Reflect.getMetadata(
      NEST_ROUTE_METADATA.path,
      OrdersController,
    ) as unknown;
    const descriptor = Object.getOwnPropertyDescriptor(OrdersController.prototype, 'findOne');
    const handler = descriptor?.value as object;
    const handlerPath = Reflect.getMetadata(NEST_ROUTE_METADATA.path, handler) as unknown;
    const handlerMethod = Reflect.getMetadata(NEST_ROUTE_METADATA.method, handler) as unknown;

    // Then
    expect(controllerPath).toBe('orders');
    expect(handlerPath).toBe(':id');
    expect(handlerMethod).toBe(RequestMethod.GET);
  });

  it('should be where @UseGuards writes, at both levels, on the real decorator', () => {
    // Given the same treatment for the key T019 added. `@UseGuards` writes the same key on a class
    // and on a method, and both apply: the guards collector reads each target rather than taking
    // the nearer one, and this is what says the framework still works that way.
    class AuthGuard {
      canActivate(): boolean {
        return true;
      }
    }
    class AdminGuard {
      canActivate(): boolean {
        return true;
      }
    }

    @Controller('orders')
    @UseGuards(AuthGuard)
    class OrdersController {
      @Get()
      @UseGuards(AdminGuard)
      list(): string {
        return 'all';
      }
    }

    // When
    const onClass = Reflect.getMetadata(NEST_GUARD_METADATA, OrdersController) as unknown;
    const descriptor = Object.getOwnPropertyDescriptor(OrdersController.prototype, 'list');
    const onHandler = Reflect.getMetadata(NEST_GUARD_METADATA, descriptor?.value as object);

    // Then
    expect(onClass).toEqual([AuthGuard]);
    expect(onHandler).toEqual([AdminGuard]);
  });

  it('should be where @UsePipes, @HttpCode and the parameter decorators write', () => {
    // Given the keys TX-COLLECTORS added, decorated with the real decorators. The route
    // argument bindings are the one two-target key: controller class and method name together.
    class TrimPipe {
      transform(value: unknown): unknown {
        return value;
      }
    }

    @Controller('orders')
    @UsePipes(TrimPipe)
    class OrdersController {
      @Get()
      @HttpCode(201)
      list(@Query('sort', TrimPipe) sort?: string): string {
        return sort ?? 'all';
      }
    }

    // When
    const descriptor = Object.getOwnPropertyDescriptor(OrdersController.prototype, 'list');
    const handler = descriptor?.value as object;
    const onClass = Reflect.getMetadata(NEST_PIPES_METADATA, OrdersController) as unknown;
    const code = Reflect.getMetadata(NEST_HTTP_CODE_METADATA, handler) as unknown;
    const bindings = Reflect.getMetadata(
      NEST_ROUTE_ARGS_METADATA,
      OrdersController,
      'list',
    ) as Record<string, { index: number; data?: unknown; pipes?: unknown[] }>;

    // Then the shape is exactly what the pipes collector and the handler scan read: the query
    // paramtype number, the bound name under `data`, and the parameter pipe in `pipes`
    expect(onClass).toEqual([TrimPipe]);
    expect(code).toBe(201);
    expect(bindings[`${String(NEST_ROUTE_PARAMTYPES.query)}:0`]).toMatchObject({
      index: 0,
      data: 'sort',
      pipes: [TrimPipe],
    });
  });

  it('should mark a custom parameter decorator with the marker the scan refuses on', () => {
    // Given `createParamDecorator`, whose factory receives the whole execution context
    const Actor = createParamDecorator(() => 'somebody');

    class AuditController {
      log(actor: unknown): unknown {
        return actor;
      }
    }
    Actor()(AuditController.prototype, 'log', 0);

    // When
    const bindings = Reflect.getMetadata(
      NEST_ROUTE_ARGS_METADATA,
      AuditController,
      'log',
    ) as Record<string, unknown>;

    // Then the key carries the marker by inclusion, which is how the scan tells it apart
    expect(Object.keys(bindings)).toHaveLength(1);
    expect(Object.keys(bindings)[0]).toContain(NEST_CUSTOM_ROUTE_ARGS_MARKER);
  });

  it('should write the request scope where the handler scan checks for it', () => {
    // Given `@Controller({ scope: Scope.REQUEST })`, the controller shape the scan refuses.
    // Empty classes, honestly: the scope lives in metadata on the class object, not in a body.
    @Controller({ path: 'orders', scope: Scope.REQUEST })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class ScopedController {}

    @Controller('orders')
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class PlainController {}

    // When
    const scoped = Reflect.getMetadata(NEST_SCOPE_OPTIONS_METADATA, ScopedController) as unknown;
    const plain = Reflect.getMetadata(NEST_SCOPE_OPTIONS_METADATA, PlainController) as unknown;

    // Then, and the default is the absence this package reads as `NEST_DEFAULT_SCOPE`
    expect(scoped).toMatchObject({ scope: Scope.REQUEST });
    expect(Scope.DEFAULT).toBe(NEST_DEFAULT_SCOPE);
    expect((plain as { scope?: number } | undefined)?.scope ?? NEST_DEFAULT_SCOPE).toBe(
      NEST_DEFAULT_SCOPE,
    );
  });

  it('should be where @Sse writes, which is __sse__ and not sse', () => {
    // Given the key T020 added, measured rather than guessed: a collector looking for a key named
    // after the decorator finds nothing on every streaming route and reports that the application
    // has none, which is the quietest way to be wrong about a whole feature.
    @Controller('jobs')
    class JobsController {
      @Sse('events')
      events(): string {
        return 'stream';
      }
    }

    // When
    const descriptor = Object.getOwnPropertyDescriptor(JobsController.prototype, 'events');
    const handler = descriptor?.value as object;

    // Then, and the route half of what `@Sse` writes is asserted beside it, because a streaming
    // route is discovered as a GET like any other
    expect(Reflect.getMetadata(NEST_SSE_METADATA, handler)).toBe(true);
    expect(Reflect.getMetadata(NEST_ROUTE_METADATA.path, handler)).toBe('events');
    expect(Reflect.getMetadata(NEST_ROUTE_METADATA.method, handler)).toBe(RequestMethod.GET);
  });
});

describe('the global enhancer registrations, asked of a real container', () => {
  it('should name the four tokens the framework exports', () => {
    // Given the four strings TX-GLOBALGUARD reads, written as literals in this package
    const exported = createRequire(import.meta.url)('@nestjs/core') as Record<string, unknown>;

    // Then
    expect(NEST_ENHANCER_TOKENS.guard).toBe(exported.APP_GUARD);
    expect(NEST_ENHANCER_TOKENS.interceptor).toBe(exported.APP_INTERCEPTOR);
    expect(NEST_ENHANCER_TOKENS.pipe).toBe(exported.APP_PIPE);
    expect(NEST_ENHANCER_TOKENS.filter).toBe(exported.APP_FILTER);
  });

  it('should find a guard registered under APP_GUARD, by class and by factory', async () => {
    // Given the arrangement the reference reported zero guards for until 2026-08-12: an
    // application whose entire policy is a provider under `APP_GUARD` and no `@UseGuards` anywhere
    @Module({
      imports: [DiscoveryModule],
      providers: [
        { provide: APP_GUARD, useClass: ReadonlyGuard },
        { provide: APP_GUARD, useFactory: (): AuditGuard => new AuditGuard() },
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class AppModule {}

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    try {
      // When
      const reading = readGlobalGuards(app.get(DiscoveryService));

      // Then. THE `useFactory` CASE IS WHY THIS ASSERTION NAMES BOTH: under a factory the
      // wrapper's `metatype` is the factory function, so a reading that trusted it named the
      // guard `useFactory` on every route. The instance is the guard under all three provider
      // forms, and this case is what turned that from an opinion into a measurement.
      expect(reading.names).toEqual(['ReadonlyGuard', 'AuditGuard']);
      expect(reading.anonymous).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('should count a global guard it cannot name rather than calling it Object', async () => {
    // Given `useValue` with a plain object, which is a legal guard with no class behind it. The
    // constructor of an object literal is `Object`, and a row reading `Object` would be a name
    // this package invented for something the application never named.
    @Module({
      imports: [DiscoveryModule],
      providers: [{ provide: APP_GUARD, useValue: { canActivate: (): boolean => true } }],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class AppModule {}

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    try {
      // When
      const reading = readGlobalGuards(app.get(DiscoveryService));

      // Then
      expect(reading.names).toEqual([]);
      expect(reading.anonymous).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('should not see a request scoped APP_GUARD, which is the gap SPEC 6.2.1 names', async () => {
    // Given. This asserts a limitation rather than a feature, on purpose. A request scoped
    // enhancer goes into the module's `injectables` and `DiscoveryService` enumerates providers,
    // so it is unread; SPEC 6.2.1 says so out loud rather than leaving it to be discovered. The
    // day the framework moves it into `providers`, this case goes red and the sentence in SPEC
    // gets corrected, which is the only way a documented gap stops being a lie quietly.
    @Module({
      imports: [DiscoveryModule],
      providers: [{ provide: APP_GUARD, useClass: RequestScopedGuard }],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class AppModule {}

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    try {
      // When
      const reading = readGlobalGuards(app.get(DiscoveryService));

      // Then
      expect(reading).toEqual({ names: [], anonymous: 0 });
    } finally {
      await app.close();
    }
  });

  it('should leave an interceptor, a pipe and a filter out of the guard reading', async () => {
    // Given all four families registered at once. Only guards are read in this pass, per SPEC
    // 6.2.1, and a reading that matched on "is an enhancer" would put a pipe in the guards row.
    @Module({
      imports: [DiscoveryModule],
      providers: [
        { provide: APP_GUARD, useClass: ReadonlyGuard },
        { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
        { provide: APP_PIPE, useClass: TrimPipe },
        { provide: APP_FILTER, useClass: EverythingFilter },
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class AppModule {}

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    try {
      // When
      const reading = readGlobalGuards(app.get(DiscoveryService));

      // Then
      expect(reading.names).toEqual(['ReadonlyGuard']);
    } finally {
      await app.close();
    }
  });

  it('should read nothing from an application that registers no enhancer', async () => {
    // Given, because an empty answer has to be reachable: a collector handed a stale list would
    // put a guard on every route of an application that has none
    @Module({ imports: [DiscoveryModule] })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class AppModule {}

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    try {
      // Then
      expect(readGlobalGuards(app.get(DiscoveryService))).toEqual({ names: [], anonymous: 0 });
    } finally {
      await app.close();
    }
  });
});

describe('the request method table', () => {
  it('should name every member it claims, with the value the framework gives it', () => {
    // Given, the eight NestJS 10 and 11 agree on. `ALL` is deliberately absent: a handler
    // registered for every method is not one operation.
    const expected: Readonly<Record<number, string>> = {
      [RequestMethod.GET]: 'get',
      [RequestMethod.POST]: 'post',
      [RequestMethod.PUT]: 'put',
      [RequestMethod.DELETE]: 'delete',
      [RequestMethod.PATCH]: 'patch',
      [RequestMethod.OPTIONS]: 'options',
      [RequestMethod.HEAD]: 'head',
      [RequestMethod.SEARCH]: 'search',
    };

    // Then
    expect(NEST_REQUEST_METHODS).toEqual(expected);
    expect(NEST_REQUEST_METHODS[RequestMethod.ALL]).toBeUndefined();
  });
});

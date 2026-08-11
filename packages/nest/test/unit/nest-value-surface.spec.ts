import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Controller, Get, RequestMethod } from '@nestjs/common';
import {
  NEST_CORE_VALUE_NAMES,
  NEST_REQUEST_METHODS,
  NEST_ROUTE_METADATA,
} from '../../src/shared/types/nest-surface';
import {
  loadNestCore,
  nestCoreVersion,
} from '../../src/runtime/infrastructure/adapters/nest-core.adapter';

/**
 * The value half of the NestJS surface, asked of the installed framework rather than assumed.
 *
 * `shared/types/nest-surface.ts` already promised that the structural half is the whole coupling
 * and that a compatibility test reads it. TX-FORROOT added a value half: five names loaded from
 * `@nestjs/core`, three metadata keys, and eight numbers of an enum. All three are the framework's
 * on-disk format rather than its documentation, so all three are checked here against the copy
 * that is installed, and against both majors by the compatibility matrix.
 *
 * THIS FILE IS ALLOWED TO IMPORT `@nestjs/common` AND `src` IS NOT. A test may use a
 * devDependency; the published package may not, and the reason is in `nest-core.adapter.ts`.
 */

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

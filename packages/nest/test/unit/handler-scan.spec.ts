import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { scanHandlerReads } from '../../src/runtime/domain/handler-scan';
import {
  metadataReflect,
  NEST_ROUTE_ARGS_METADATA,
  NEST_SCOPE_OPTIONS_METADATA,
} from '../../src/shared/types/nest-surface';
import type { DeclaredParameter } from '../../src/runtime/domain/handler-scan';
import type { HandlerLike } from '../../src/shared/types/nest-surface';

/**
 * The handler scan, held to the distinction SPEC 6.2.1 requires it to carry: `not-seen-read`
 * only where every access path was accounted for, `unaccounted` where it was not, and no fact
 * at all where the handler cannot be accounted for. Every refusal the design names is driven
 * here: whole object bindings, destructuring, opaque use, `@Req`, `@Res`, custom decorators,
 * request scoped controllers, a wrapper, and cookie parameters.
 */

const reflect = metadataReflect();

/** A controller class carrying prepared route argument metadata for one method. */
function controllerWith(
  bindings: Record<string, { index: number; data?: unknown; pipes?: unknown[] }> | undefined,
  scope?: number,
): object {
  // An empty class is the honest fixture: the scan reads metadata off the class object, and a
  // member would be a body pretending the metadata needs one.
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class Scanned {}
  if (bindings !== undefined) {
    Reflect.defineMetadata(NEST_ROUTE_ARGS_METADATA, bindings, Scanned, 'list');
  }
  if (scope !== undefined) {
    Reflect.defineMetadata(NEST_SCOPE_OPTIONS_METADATA, { scope }, Scanned);
  }

  return Scanned;
}

function declared(...parameters: DeclaredParameter[]): readonly DeclaredParameter[] {
  return parameters;
}

describe('scanHandlerReads', () => {
  it('should call a name-bound parameter read and an unbound one not seen read', () => {
    // Given `@Query('sort')` bound and `page` declared with no binding anywhere
    const controller = controllerWith({ '4:0': { index: 0, data: 'sort' } });
    const handler: HandlerLike = function list(sort: unknown) {
      return sort;
    };

    // When
    const result = scanHandlerReads(
      reflect,
      controller,
      'list',
      handler,
      declared({ in: 'query', name: 'sort' }, { in: 'query', name: 'page' }),
    );

    // Then: the location's every access path is the one named binding, so absence is a verdict
    expect(result).toEqual({
      kind: 'scanned',
      parameters: [
        { in: 'query', name: 'sort', verdict: 'read' },
        { in: 'query', name: 'page', verdict: 'not-seen-read' },
      ],
    });
  });

  it('should read property access through a whole object binding, and leave the rest unread', () => {
    // Given `@Query() q` and a body reading two properties, dot and literal bracket
    const controller = controllerWith({ '4:0': { index: 0 } });
    const handler: HandlerLike = function list(q: Record<string, unknown>) {
      const sort = q.sort;

      // The bracket form is the material under test, not a style choice: the scan must read a
      // literal computed access the way emitted code sometimes spells one.
      // eslint-disable-next-line @typescript-eslint/dot-notation
      return [sort, q['filter']];
    };

    // When
    const result = scanHandlerReads(
      reflect,
      controller,
      'list',
      handler,
      declared(
        { in: 'query', name: 'sort' },
        { in: 'query', name: 'filter' },
        { in: 'query', name: 'page' },
      ),
    );

    // Then
    expect(result).toEqual({
      kind: 'scanned',
      parameters: [
        { in: 'query', name: 'sort', verdict: 'read' },
        { in: 'query', name: 'filter', verdict: 'read' },
        { in: 'query', name: 'page', verdict: 'not-seen-read' },
      ],
    });
  });

  it('should read a destructured whole object binding, and refuse a rest element', () => {
    // Given `@Query() { sort, filter: renamed }`, which names exactly what it reads
    const controller = controllerWith({ '4:0': { index: 0 } });
    const handler: HandlerLike = function list({ sort, filter: renamed }: Record<string, unknown>) {
      return [sort, renamed];
    };

    // When
    const result = scanHandlerReads(
      reflect,
      controller,
      'list',
      handler,
      declared({ in: 'query', name: 'filter' }, { in: 'query', name: 'page' }),
    );

    // Then the renamed key is the read name, and what the pattern does not name is not read
    expect(result).toEqual({
      kind: 'scanned',
      parameters: [
        { in: 'query', name: 'filter', verdict: 'read' },
        { in: 'query', name: 'page', verdict: 'not-seen-read' },
      ],
    });

    // And with a rest element the whole location is reachable, so nothing is concluded
    const rest = scanHandlerReads(
      reflect,
      controllerWith({ '4:0': { index: 0 } }),
      'list',
      function list({ sort, ...others }: Record<string, unknown>) {
        return [sort, others];
      },
      declared({ in: 'query', name: 'page' }),
    );
    expect(rest).toEqual({
      kind: 'scanned',
      parameters: [{ in: 'query', name: 'page', verdict: 'unaccounted' }],
    });
  });

  it('should mark a location unaccounted when the whole object is used opaquely', () => {
    // Given `@Query() q` handed to a function, through which any property may be read
    const controller = controllerWith({ '4:0': { index: 0 } });
    const handler: HandlerLike = function list(q: Record<string, unknown>) {
      return JSON.stringify(q);
    };

    // When
    const result = scanHandlerReads(
      reflect,
      controller,
      'list',
      handler,
      declared({ in: 'query', name: 'sort' }),
    );

    // Then `not-seen-read` is not claimed, because absence was not accounted for
    expect(result).toEqual({
      kind: 'scanned',
      parameters: [{ in: 'query', name: 'sort', verdict: 'unaccounted' }],
    });
  });

  it('should fold header names case insensitively and take a required header as read', () => {
    // Given `@Headers('x-request-id')` against the document's own spelling
    const controller = controllerWith({ '6:0': { index: 0, data: 'x-request-id' } });
    const handler: HandlerLike = function list(id: unknown) {
      return id;
    };

    // When
    const result = scanHandlerReads(
      reflect,
      controller,
      'list',
      handler,
      declared({ in: 'header', name: 'X-Request-Id' }),
    );

    // Then
    expect(result).toEqual({
      kind: 'scanned',
      parameters: [{ in: 'header', name: 'X-Request-Id', verdict: 'read' }],
    });
  });

  it('should never account for a cookie parameter, since no binding reads cookies', () => {
    // Given a declared cookie on a handler with no bindings at all
    const result = scanHandlerReads(
      reflect,
      controllerWith({}),
      'list',
      function list() {
        return undefined;
      },
      declared({ in: 'cookie', name: 'session' }, { in: 'path', name: 'id' }),
    );

    // Then the cookie stays a statement about the scan, and the path one about the handler
    expect(result).toEqual({
      kind: 'scanned',
      parameters: [
        { in: 'cookie', name: 'session', verdict: 'unaccounted' },
        { in: 'path', name: 'id', verdict: 'not-seen-read' },
      ],
    });
  });

  it('should be blind on @Req and @Res, through which everything is reachable', () => {
    // Given
    const request = scanHandlerReads(
      reflect,
      controllerWith({ '0:0': { index: 0 } }),
      'list',
      function list(req: unknown) {
        return req;
      },
      declared({ in: 'query', name: 'sort' }),
    );
    const response = scanHandlerReads(
      reflect,
      controllerWith({ '1:0': { index: 0 } }),
      'list',
      function list(res: unknown) {
        return res;
      },
      declared({ in: 'query', name: 'sort' }),
    );

    // Then no fact, and the reason says why
    expect(request.kind).toBe('blind');
    expect(response.kind).toBe('blind');
    if (request.kind === 'blind') expect(request.reason).toContain('request or response');
  });

  it('should be blind on a custom parameter decorator, whose factory sees the whole context', () => {
    // Given the key shape `createParamDecorator` writes
    const result = scanHandlerReads(
      reflect,
      controllerWith({ 'abc123__customRouteArgs__:0': { index: 0 } }),
      'list',
      function list(value: unknown) {
        return value;
      },
      declared({ in: 'query', name: 'sort' }),
    );

    // Then
    expect(result.kind).toBe('blind');
    if (result.kind === 'blind') expect(result.reason).toContain('custom parameter decorator');
  });

  it('should report the reads when a custom decorator sits beside full named coverage', () => {
    // Given `@Auth() auth, @Param('id') id, @Query('debug') debug`: a factory this scan cannot
    // follow, and every declared parameter bound by a name in the signature all the same
    const controller = controllerWith({
      'abc123__customRouteArgs__:0': { index: 0 },
      '5:1': { index: 1, data: 'id' },
      '4:2': { index: 2, data: 'debug' },
    });
    const handler: HandlerLike = function list(auth: unknown, id: unknown, debug: unknown) {
      return [auth, id, debug];
    };

    // When
    const result = scanHandlerReads(
      reflect,
      controller,
      'list',
      handler,
      declared({ in: 'path', name: 'id' }, { in: 'query', name: 'debug' }),
    );

    // Then: a factory can add an access path and cannot unbind an argument the signature binds,
    // so the reads are known and the row is measured rather than silent
    expect(result).toEqual({
      kind: 'scanned',
      parameters: [
        { in: 'path', name: 'id', verdict: 'read' },
        { in: 'query', name: 'debug', verdict: 'read' },
      ],
    });
  });

  it('should still be blind where a whole object binding covers a parameter beside a custom one', () => {
    // Given `@Auth() auth, @Query() q`, which is the crux rather than a detail: a factory doing
    // ctx.switchToHttp().getRequest().query.sort is exactly the access path this file refuses to
    // conclude over, and calling `sort` unread would tell a reader to delete a parameter that is
    // read. A whole object binding is not a name, so it does not cover anything.
    const controller = controllerWith({
      'abc123__customRouteArgs__:0': { index: 0 },
      '4:1': { index: 1 },
    });
    const handler: HandlerLike = function list(auth: unknown, q: Record<string, unknown>) {
      return [auth, q.page];
    };

    // When
    const result = scanHandlerReads(
      reflect,
      controller,
      'list',
      handler,
      declared({ in: 'query', name: 'sort' }),
    );

    // Then, and the reason names the parameter nothing binds rather than the handler
    expect(result.kind).toBe('blind');
    if (result.kind === 'blind') {
      expect(result.reason).toBe(
        'a custom parameter decorator reads the request, so whether sort is read cannot be seen',
      );
      expect(result.detail).toContain('covered only by a whole object binding');
    }
  });

  it('should still be blind on @Req written after a custom decorator, which comes later in the key order', () => {
    // Given both, with the custom key first: route argument keys are walked in insertion order,
    // so an answer given at the custom key would be given before the `@Req` binding was seen. The
    // named coverage is complete, which is what makes the custom half alone say nothing.
    const result = scanHandlerReads(
      reflect,
      controllerWith({
        'abc123__customRouteArgs__:0': { index: 0 },
        '4:1': { index: 1, data: 'sort' },
        '0:2': { index: 2 },
      }),
      'list',
      function list(auth: unknown, sort: unknown, req: unknown) {
        return [auth, sort, req];
      },
      declared({ in: 'query', name: 'sort' }),
    );

    // Then the request binding is what answers, not the coverage
    expect(result.kind).toBe('blind');
    if (result.kind === 'blind') expect(result.reason).toContain('request or response');
  });

  it('should be blind on a request scoped controller, whose fields can hold the request', () => {
    // Given `@Controller({ scope: Scope.REQUEST })`, which is 2 on both supported majors
    const result = scanHandlerReads(
      reflect,
      controllerWith({ '4:0': { index: 0, data: 'sort' } }, 2),
      'list',
      function list(sort: unknown) {
        return sort;
      },
      declared({ in: 'query', name: 'sort' }),
    );

    // Then
    expect(result.kind).toBe('blind');
    if (result.kind === 'blind') {
      expect(result.reason).toContain(
        'request scoped, so which parameters the handler reads cannot be seen',
      );
      expect(result.detail).toContain('request or transient scoped');
      expect(result.detail).toContain('may inject REQUEST and read any parameter out of a field');
    }
  });

  it('should be blind on a wrapper whose source does not match the bindings', () => {
    // Given a whole object binding at index 1 on a function with one parameter: a decorator
    // replaced the descriptor, and scanning the wrapper would report the wrong function
    const result = scanHandlerReads(
      reflect,
      controllerWith({ '4:1': { index: 1 } }),
      'list',
      function list(only: unknown) {
        return only;
      },
      declared({ in: 'query', name: 'sort' }),
    );

    // Then
    expect(result.kind).toBe('blind');
    if (result.kind === 'blind') {
      expect(result.reason).toContain('is wrapped, so the scan would be reading a different');
      expect(result.detail).toContain(
        "Scanning the wrapper would report its reads as the handler's",
      );
    }
  });

  it('should be blind on a paramtype outside the table, rather than guessing at it', () => {
    // Given a binding kind this scan does not know, which may open the whole request
    const result = scanHandlerReads(
      reflect,
      controllerWith({ '12:0': { index: 0 } }),
      'list',
      function list(raw: unknown) {
        return raw;
      },
      declared({ in: 'query', name: 'sort' }),
    );

    // Then
    expect(result.kind).toBe('blind');
    if (result.kind === 'blind') expect(result.reason).toContain('paramtype 12');
  });

  it('should keep a body binding out of the verdicts, since body is not a parameter location', () => {
    // Given `@Body() body` beside a named query binding
    const controller = controllerWith({
      '3:0': { index: 0 },
      '4:1': { index: 1, data: 'sort' },
    });
    const handler: HandlerLike = function list(body: unknown, sort: unknown) {
      return [body, sort];
    };

    // When
    const result = scanHandlerReads(
      reflect,
      controller,
      'list',
      handler,
      declared({ in: 'query', name: 'sort' }),
    );

    // Then the body binding neither blinds the scan nor reads any declared parameter
    expect(result).toEqual({
      kind: 'scanned',
      parameters: [{ in: 'query', name: 'sort', verdict: 'read' }],
    });
  });
});

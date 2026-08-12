import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expandSourceLink, type IRDocument, type IROperation } from '@openref/core';
import { runRuntimePass } from '../../src/runtime/application/services/runtime-pass.service';
import { sourceCollector } from '../../src/runtime/infrastructure/collectors/source.collector';
import { closeFunctionLocator } from '../../src/runtime/infrastructure/adapters/function-location.adapter';
import type { FunctionLocationResult } from '../../src/runtime/infrastructure/adapters/function-location.adapter';
import { NEST_ROUTE_METADATA } from '../../src/shared/types/nest-surface';
import type {
  DiscoveryServiceLike,
  HandlerLike,
  ModuleRefLike,
  ReflectorLike,
} from '../../src/shared/types/nest-surface';

/**
 * `sourceCollector`, through the whole pass rather than on its own.
 *
 * THROUGH THE PASS BECAUSE THE TWO CASES T018 NAMES ARE ABOUT WHICH HANDLER REACHED THE NODE.
 * "Two controllers share a method name" and "an inherited handler attributes to the declaring
 * class" are questions about discovery, pairing and the collector agreeing, and a test of the
 * collector alone would answer them by construction: it would hand the collector the answer and
 * then assert it.
 *
 * THE LOCATOR IS REAL IN THE FIRST HALF AND INJECTED IN THE SECOND. The real one proves the
 * collector reports the line V8 gives; the injected one is how the degradations are reached at
 * all, since a source file cannot be made to have no source map from inside a test.
 */

/** Both controllers declare `findAll`, which is the norm rather than the exception. */
class OrdersController {
  findAll(): string {
    return 'orders';
  }
}

class InvoicesController {
  findAll(): string {
    return 'invoices';
  }
}

/** A base class carrying the handler, and a subclass that inherits it and serves it. */
class CrudController {
  list(): string {
    return 'from the base class';
  }
}

class ProductsController extends CrudController {}

/**
 * Where a method of this file is written, read out of the file rather than counted.
 *
 * @param marker - The line as it is written here, without leading whitespace
 * @returns The one based line number
 */
function lineOf(marker: string): number {
  return (
    readFileSync(import.meta.filename, 'utf8')
      .split('\n')
      .findIndex((line) => line.trim() === marker) + 1
  );
}

/** Route metadata for one controller and its handlers, in the form `Reflector` reads it. */
interface RouteSpec {
  readonly controller: new (...args: never[]) => unknown;
  readonly prefix: string;
  readonly handlers: readonly { readonly name: string; readonly path: string }[];
}

/**
 * Builds the reflector, the discovery service and the document for a set of controllers.
 *
 * @param specs - The controllers to serve
 * @returns Everything `runRuntimePass` needs
 */
function harness(specs: readonly RouteSpec[]): {
  readonly discovery: DiscoveryServiceLike;
  readonly reflector: ReflectorLike;
  readonly moduleRef: ModuleRefLike;
  readonly document: IRDocument;
} {
  const metadata = new Map<unknown, Record<string, unknown>>();
  const nodes = new Map<string, IROperation>();

  for (const spec of specs) {
    metadata.set(spec.controller, { [NEST_ROUTE_METADATA.path]: spec.prefix });

    for (const handler of spec.handlers) {
      const prototype = spec.controller.prototype as Record<string, unknown>;
      const fn =
        Object.getPrototypeOf(prototype) === Object.prototype ? prototype[handler.name] : undefined;
      const owned = fn ?? findInherited(prototype, handler.name);
      metadata.set(owned, {
        [NEST_ROUTE_METADATA.method]: 0,
        [NEST_ROUTE_METADATA.path]: handler.path,
      });

      const path = `/${[spec.prefix, handler.path].filter((part) => part !== '').join('/')}`;
      const id = `${spec.controller.name}_${handler.name}`;
      nodes.set(id, {
        kind: 'operation',
        id,
        rawOperationId: id,
        method: 'get',
        path,
        tags: [],
        deprecated: false,
        parameters: [],
        responses: [],
        security: [],
        servers: [],
      } as unknown as IROperation);
    }
  }

  return {
    discovery: {
      getControllers: () =>
        specs.map((spec) => ({ metatype: spec.controller, instance: new spec.controller() })),
      getProviders: () => [],
    },
    reflector: {
      get: (key, target) => metadata.get(target)?.[String(key)] ?? undefined,
      getAllAndOverride: () => undefined,
    },
    moduleRef: { get: () => undefined },
    document: {
      kind: 'openapi',
      info: { title: 'Test', version: '1.0.0' },
      nodes: nodes as unknown as IRDocument['nodes'],
      schemas: new Map(),
      navigation: [],
      hash: '',
    } as unknown as IRDocument,
  };
}

/**
 * Walks the prototype chain for a method, which is how an inherited handler is reached.
 *
 * @param prototype - The subclass's prototype
 * @param name - Method name
 * @returns The function, wherever it is written
 */
function findInherited(prototype: object, name: string): unknown {
  let current: object | null = prototype;
  while (current !== null && current !== Object.prototype) {
    const found = Object.getOwnPropertyDescriptor(current, name);
    if (found !== undefined) return found.value;
    current = Object.getPrototypeOf(current) as object | null;
  }

  return undefined;
}

/**
 * Runs the pass with the source collector and returns the sources it attached.
 *
 * @param specs - The controllers to serve
 * @param locate - A locator, when the case needs a made up answer
 * @returns The `source` of every node, by node id
 */
function sourcesOf(
  specs: readonly RouteSpec[],
  locate?: (handler: HandlerLike) => FunctionLocationResult,
): Map<string, IROperation['runtime']> {
  const built = harness(specs);
  const collector = sourceCollector(locate === undefined ? {} : { locate });

  const result = runRuntimePass(built.document, {
    collectors: [collector],
    discovery: built.discovery,
    reflector: built.reflector,
    moduleRef: built.moduleRef,
  });

  closeFunctionLocator();

  return new Map([...result.document.nodes].map(([id, node]) => [id, node.runtime]));
}

/**
 * A file that really is tracked by this repository, and its path from the root.
 *
 * IT IS THIS FILE, AND IT IS DERIVED FROM `import.meta.url` RATHER THAN FROM `process.cwd()`.
 * T025 changed both cases that used to name `packages/nest/src/a.ts` relative to the working
 * directory: that path does not exist, and the collector now refuses to link an untracked file
 * because `{ref}` is the sha of HEAD and a file that is not in that commit is a link to a 404.
 * The working directory was the second half of the same fragility, since it is the repository
 * root under the workspace runner and the package root under a filtered one.
 */
const TRACKED_FILE = fileURLToPath(import.meta.url);
const TRACKED_RELATIVE = 'packages/nest/test/unit/source-collector.spec.ts';

describe('sourceCollector', () => {
  it('should attribute the right handler when two controllers share a method name', () => {
    // Given the case T018 names, and the one a match on the method name alone would get wrong.
    const specs: RouteSpec[] = [
      { controller: OrdersController, prefix: 'orders', handlers: [{ name: 'findAll', path: '' }] },
      {
        controller: InvoicesController,
        prefix: 'invoices',
        handlers: [{ name: 'findAll', path: '' }],
      },
    ];

    // When
    const sources = sourcesOf(specs);

    // Then each node names its own class, and the two lines are the two methods above
    expect(sources.get('OrdersController_findAll')?.source?.controller).toBe('OrdersController');
    expect(sources.get('InvoicesController_findAll')?.source?.controller).toBe(
      'InvoicesController',
    );
    // The first `findAll(): string {` in this file is the one on `OrdersController`. The second
    // is found through its own body, which is the only line of the two classes that differs.
    expect(sources.get('OrdersController_findAll')?.source?.line).toBe(
      lineOf('findAll(): string {'),
    );
    expect(sources.get('InvoicesController_findAll')?.source?.line).toBe(
      lineOf("return 'invoices';") - 1,
    );
  });

  it('should attribute an inherited handler to the class it is written on', () => {
    // Given `ProductsController extends CrudController` with `list` inherited. The route belongs
    // to the subclass and the method body is in the base class's file, and SPEC 6.3's `source` is
    // where to find the code. Linking to the subclass would land a reader on a class that does
    // not contain the method they clicked.
    const specs: RouteSpec[] = [
      {
        controller: ProductsController,
        prefix: 'products',
        handlers: [{ name: 'list', path: '' }],
      },
    ];

    // When
    const sources = sourcesOf(specs);

    // Then the declaring class, and the line the body is actually on
    const source = sources.get('ProductsController_list')?.source;
    expect(source?.controller).toBe('CrudController');
    expect(source?.handler).toBe('list');
    expect(source?.line).toBe(lineOf('list(): string {'));
  });

  it('should express the file relative to the repository, never as an absolute path', () => {
    // Given. An absolute path names the person who built the image and the machine they built it
    // on, and it would be served to every reader of the documentation.
    const specs: RouteSpec[] = [
      { controller: OrdersController, prefix: 'orders', handlers: [{ name: 'findAll', path: '' }] },
    ];

    // When
    const sources = sourcesOf(specs);

    // Then
    const file = sources.get('OrdersController_findAll')?.source?.file;
    expect(file).toBe('packages/nest/test/unit/source-collector.spec.ts');
    expect(file?.startsWith('/')).toBe(false);
  });

  it('should report the class and the method even when the handler cannot be located', () => {
    // Given a locator that found nothing, which is a hardened runtime or a generated handler.
    const specs: RouteSpec[] = [
      { controller: OrdersController, prefix: 'orders', handlers: [{ name: 'findAll', path: '' }] },
    ];

    // When
    const sources = sourcesOf(specs, () => ({ reason: 'V8 reported no [[FunctionLocation]]' }));

    // Then the half that is knowable is still reported, because `OrdersController.findAll` is
    // useful on its own and is more than the specification could ever say
    const source = sources.get('OrdersController_findAll')?.source;
    expect(source).toEqual({ controller: 'OrdersController', handler: 'findAll' });
  });

  it('should emit a file with no line rather than guessing one', () => {
    // Given a build whose script names a source map that cannot be read, which is the case where
    // the line is genuinely unknown. A build with NO map is a different case and not this one:
    // there the emitted JavaScript is the source and the line is precise, which the NestJS 10 arm
    // of the compatibility matrix pins.
    const specs: RouteSpec[] = [
      { controller: OrdersController, prefix: 'orders', handlers: [{ name: 'findAll', path: '' }] },
    ];

    // When
    const sources = sourcesOf(specs, () => ({
      // A FILE THAT REALLY IS TRACKED, CHANGED IN T025. It used to name `src/a.ts`, which does
      // not exist, and the collector now refuses to link an untracked path because `{ref}` is the
      // sha of HEAD and a file that is not in that commit is a link to a 404.
      location: { file: TRACKED_FILE },
      reason: 'the source map could not be read',
    }));

    // Then
    const source = sources.get('OrdersController_findAll')?.source;
    expect(source?.file).toBe(TRACKED_RELATIVE);
    expect(source?.line).toBeUndefined();
  });

  it('should degrade to a file link rather than emitting #LNaN, through the real expander', () => {
    // Given the whole of T018's fourth test, from the collector to the URL. The two halves are in
    // two packages, so this is the one place they meet.
    const specs: RouteSpec[] = [
      { controller: OrdersController, prefix: 'orders', handlers: [{ name: 'findAll', path: '' }] },
    ];
    const sources = sourcesOf(specs, () => ({
      location: { file: TRACKED_FILE },
    }));
    const source = sources.get('OrdersController_findAll')?.source;

    // When
    const link = expandSourceLink(
      'https://github.com/org/repo/blob/{ref}/{file}#L{line}',
      source ?? { controller: '', handler: '' },
      'a1b2c3d',
    );

    // Then
    expect(link.url).toBe(`https://github.com/org/repo/blob/a1b2c3d/${TRACKED_RELATIVE}`);
    expect(link.url).not.toContain('NaN');
    expect(link.withoutLine).toBe(true);
  });

  it('should refuse a file outside the repository rather than linking out of it', () => {
    // Given a handler in a linked package beside the repository, which pnpm produces.
    const specs: RouteSpec[] = [
      { controller: OrdersController, prefix: 'orders', handlers: [{ name: 'findAll', path: '' }] },
    ];

    // When
    const sources = sourcesOf(specs, () => ({
      location: { file: '/elsewhere/src/a.ts', line: 4 },
    }));

    // Then
    const source = sources.get('OrdersController_findAll')?.source;
    expect(source?.file).toBeUndefined();
    expect(source?.controller).toBe('OrdersController');
  });

  it('should keep the reason for every source it could not resolve', () => {
    // Given. "This endpoint has no source link" and "this endpoint was never looked at" are
    // different states, and only a record of the reason tells a reader which one they are in.
    const built = harness([
      { controller: OrdersController, prefix: 'orders', handlers: [{ name: 'findAll', path: '' }] },
    ]);
    const collector = sourceCollector({ locate: () => ({ reason: 'nothing was found' }) });

    // When
    runRuntimePass(built.document, {
      collectors: [collector],
      discovery: built.discovery,
      reflector: built.reflector,
      moduleRef: built.moduleRef,
    });

    // Then
    expect(collector.problems()).toEqual([
      { subject: 'OrdersController.findAll', reason: 'nothing was found' },
    ]);
  });
});

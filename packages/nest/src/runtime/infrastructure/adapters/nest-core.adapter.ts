/**
 * The one value load of `@nestjs/core`, and the only file permitted to perform it.
 *
 * WHY IT IS A LOAD AND NOT AN IMPORT, measured in TX-FORROOT rather than assumed. A static
 * import at the top of this file is hoisted into the package entry, and `@openref/nest` is
 * imported today by a harness that has no NestJS at all: `tools/browser-budget` boots Express
 * directly, which is how the browser budgets prove this package puts no framework on the wire,
 * and `@nestjs/core` is not resolvable from there. A static import would fail that import,
 * taking the browser baseline, the CSP proofs and `first-minute` with it, and it would fail it
 * for the same reason in any host that installs this package without NestJS.
 *
 * WHY IT IS SYNCHRONOUS. `forRoot` returns a `DynamicModule`, which NestJS consumes as a plain
 * object the moment the decorator metadata is read. There is nothing to await inside, so a
 * dynamic `import()` would have to be resolved before `forRoot` is called, which means either an
 * async entry point that SPEC 13.1 forbids or a promise the host has to remember to await.
 *
 * WHY IT RESOLVES FROM THE APPLICATION FIRST, AND NOT FROM THIS FILE. The five names are DI
 * tokens, and a DI token is a class identity: two copies of `@nestjs/core` in one process give two
 * `DiscoveryService` classes, and the one this file loaded is then a token the application's
 * container has never heard of. NestJS reports that as a dependency it cannot resolve, naming a
 * provider the host did not write, which is a bad hour for whoever has to read it. The NestJS 10
 * arm of the compatibility matrix found exactly this, by exiting 1: `@openref/nest` has its own
 * `@nestjs/core` in a monorepo, and the fixture has another.
 *
 * So the module is resolved from the file that CALLED `forRoot`, which is the application's own
 * module file and therefore sits in the application's own tree. This file is the fallback, and it
 * is the right answer for an ordinary install, where the peer is hoisted above us and there is
 * only one copy to find. The entry point, `process.argv[1]`, was tried first and is not usable: it
 * is the test runner under Vitest, whose tree reaches a third copy again.
 *
 * WHY THE FIVE NAMES ARE THE WHOLE LIST. They are DI tokens, not helpers: `DiscoveryService`
 * enumerates controllers, `Reflector` and `ModuleRef` are what the collector contract of SPEC 6.2
 * already requires from the host, `HttpAdapterHost` is how a module reaches the adapter the route
 * table registers on, and `DiscoveryModule` has to be imported for the first of them to resolve.
 * Every one is public API in NestJS 10 and 11. The list is declared in
 * `shared/types/nest-surface.ts` beside the structural surface, where the coupling is visible.
 */

import { createRequire } from 'node:module';
import { ConfigError, ErrorCode } from '@openref/core';
import { NEST_CORE_VALUE_NAMES } from '../../../shared/types/nest-surface';

/** What the load returns: five DI tokens, kept opaque because only NestJS interprets them. */
export interface NestCoreValues {
  readonly DiscoveryModule: unknown;
  readonly DiscoveryService: unknown;
  readonly HttpAdapterHost: unknown;
  readonly ModuleRef: unknown;
  readonly Reflector: unknown;
}

let loaded: NestCoreValues | undefined;

/**
 * Loads the five tokens `forRoot` needs from the host's copy of `@nestjs/core`.
 *
 * Cached after the first call, because a host may declare several documents and every one of
 * them would otherwise re-enter the module registry for the same object.
 *
 * @returns The tokens, from the consumer's own installation
 * @throws {ConfigError} When `@nestjs/core` cannot be loaded, or does not export all five
 */
export function loadNestCore(): NestCoreValues {
  if (loaded !== undefined) return loaded;

  const required = requireNestCore();

  const missing = NEST_CORE_VALUE_NAMES.filter((name) => required[name] === undefined);
  if (missing.length > 0) {
    // Unreachable with any published NestJS 10 or 11, and checked rather than assumed because
    // the alternative is `inject: [undefined]`, which NestJS reports as a dependency it cannot
    // resolve at position 0 of a provider the host did not write.
    throw new ConfigError(
      `@nestjs/core does not export ${missing.join(', ')}, so forRoot cannot wire the runtime pass`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { missing },
    );
  }

  loaded = {
    DiscoveryModule: required.DiscoveryModule,
    DiscoveryService: required.DiscoveryService,
    HttpAdapterHost: required.HttpAdapterHost,
    ModuleRef: required.ModuleRef,
    Reflector: required.Reflector,
  };

  return loaded;
}

/**
 * Reads the module, from the application's tree when there is one.
 *
 * @returns The module namespace, as an index signature because none of it is typed here
 * @throws {ConfigError} When the package is absent or fails to load
 */
function requireNestCore(): Record<string, unknown> {
  const fromCaller = tryRequire(callerLocation());
  if (fromCaller !== undefined) return fromCaller;

  const fromHere = tryRequire(import.meta.url);
  if (fromHere !== undefined) return fromHere;

  throw new ConfigError(
    'forRoot needs @nestjs/core, which could not be loaded from the calling module or from ' +
      '@openref/nest itself. It is a peer dependency, so a host that mounts a reference ' +
      'without NestJS uses setup instead',
    ErrorCode.CONFIG_INVALID_OPTIONS,
  );
}

/**
 * Frames belonging to this package's own code, which are the ones the caller is not in.
 *
 * The published form is the first alternative and the second exists because this repository both
 * runs its tests from source and links the built package into fixture applications. A test file
 * under `packages/nest/test` is deliberately NOT own code: it stands in for an application, and it
 * resolves the framework the way one would.
 */
const OWN_FRAME = /[/\\](?:@openref[/\\]nest|packages[/\\]nest)[/\\](?:src|dist)[/\\]/;

/**
 * The file that called into this package, read off the stack.
 *
 * A STACK IS AN ODD PLACE TO LOOK AND IT IS THE ONLY PLACE THE ANSWER IS. What is wanted is the
 * application's module resolution tree, and the only thing that identifies it is a file inside
 * it. Nothing is parsed out of the frame but a path, the result is only ever used as a resolution
 * origin, and failing to find one costs the fallback rather than the boot.
 *
 * @returns The first frame outside this package, or undefined
 */
function callerLocation(): string | undefined {
  for (const line of (new Error().stack ?? '').split('\n').slice(1)) {
    const found = /(?:\(|\s|^)((?:file:\/\/)?\/[^\s()]+?):\d+:\d+\)?$/.exec(line.trim());
    const path = found?.[1];

    if (path !== undefined && !OWN_FRAME.test(path) && !path.startsWith('node:')) return path;
  }

  return undefined;
}

/**
 * Loads `@nestjs/core` as one location resolves it.
 *
 * @param from - A path or a file url to resolve from, which may be absent
 * @returns The module namespace, or undefined when this location cannot reach it
 */
function tryRequire(from: string | undefined): Record<string, unknown> | undefined {
  if (from === undefined || from === '') return undefined;

  try {
    return createRequire(from)('@nestjs/core') as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * The version of NestJS the host is running, for `IRRuntimeMeta`.
 *
 * FAIL OPEN, unlike {@link loadNestCore}. A missing version costs one line of a report, and a
 * `package.json` that cannot be read is not a reason to refuse to serve documentation. It is read
 * from the same installation the tokens came from rather than from the consumer's lockfile,
 * because a monorepo can have several.
 *
 * @returns The version, or undefined when it cannot be read
 */
export function nestCoreVersion(): string | undefined {
  try {
    const from = process.argv[1];
    const read = createRequire(from === undefined || from === '' ? import.meta.url : from);
    const manifest = read('@nestjs/core/package.json') as { version?: unknown };

    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Forgets the cached load.
 *
 * Exists for the tests that assert the failure path, which cannot be observed once a successful
 * load is remembered. It is not exported from the package.
 */
export function resetNestCoreCache(): void {
  loaded = undefined;
}

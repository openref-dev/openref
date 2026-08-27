import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ApplicationBootError,
  ErrorCode,
  ShutdownTimeoutError,
  type IRDocument,
} from '@openref/core';
import type { LoadedDocument } from '../../domain/loaded-document.types';

/**
 * How long a booted application is given to close before this loader gives up and reports it.
 *
 * Chosen to outlast an ordinary connection pool drain without holding a CI job hostage to one
 * that never will. `close` below takes it as a parameter, so a test proves the timeout path
 * without waiting it out.
 */
export const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;

/** The DI token `OpenRefModule` registers its mounted references under. */
const REFERENCES_TOKEN = 'OPENREF_REFERENCES';

/**
 * The shape this loader needs from whatever `--from-nest`'s entry produces.
 *
 * A LITERAL STRING TOKEN AND A DUCK TYPE, RATHER THAN A VALUE IMPORT OF `@openref/nest`, for the
 * reason `packages/nest/src/shared/types/nest-surface.ts` gives for the same move one layer
 * down: `cli` is not in `@openref/nest`'s declared boundary in `tools/dependency-rules.cjs`, and
 * the token is a stable string on the wire either way. `--from-nest` targets a compiled
 * application that installs `@openref/nest` itself; this package never needs to.
 */
interface BootedApplicationLike {
  get?(token: unknown, options?: { readonly strict?: boolean }): unknown;
  close?(): unknown;
}

interface MountedReferenceLike {
  readonly pass?: { readonly document?: unknown };
}

interface MountedReferencesLike {
  all(): readonly MountedReferenceLike[];
}

function isMountedReferencesLike(value: unknown): value is MountedReferencesLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'all' in value &&
    typeof (value as MountedReferencesLike).all === 'function'
  );
}

/**
 * Loads a document by booting a compiled Nest application.
 *
 * THE ENTRY'S CONTRACT: a named export `createApp`, or failing that a default export, that is a
 * function taking no required argument and returning an application, or a promise of one, not
 * yet listening, per the convention `examples/nest-minimal/src/main.ts` already establishes.
 * `NestFactory.create` is never called here: the target's own factory calls it, using whatever
 * `@nestjs/core` the target has installed, which is what keeps this package off `@nestjs/*`
 * entirely. Recorded in SPEC 17 alongside the flag surface, since it is a fact about the product
 * an integrator reads, not an implementation detail.
 *
 * @param entryPath - Path to the compiled entry, resolved against the current directory
 * @param closeTimeoutMs - Override for {@link DEFAULT_CLOSE_TIMEOUT_MS}, for tests
 * @throws {ApplicationBootError} When the entry cannot be loaded, exports no usable factory, the
 *         factory throws, or the booted application has no OpenRef reference mounted on it
 */
export async function loadFromNestApplication(
  entryPath: string,
  closeTimeoutMs: number = DEFAULT_CLOSE_TIMEOUT_MS,
): Promise<LoadedDocument> {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), entryPath)).href;

  let moduleExports: Record<string, unknown>;
  try {
    moduleExports = (await import(moduleUrl)) as Record<string, unknown>;
  } catch (error) {
    throw new ApplicationBootError(
      `could not load ${entryPath}: ${describe(error)}`,
      ErrorCode.CLI_BOOT_FAILED,
      asCause(error),
    );
  }

  const factory = bootFactory(moduleExports);
  if (factory === undefined) {
    throw new ApplicationBootError(
      `${entryPath} exports neither "createApp" nor a default function; --from-nest needs one ` +
        'that returns a NestJS application, not yet listening',
      ErrorCode.CLI_BOOT_FAILED,
    );
  }

  let app: BootedApplicationLike;
  try {
    app = (await factory()) as BootedApplicationLike;
  } catch (error) {
    throw new ApplicationBootError(
      `${entryPath} failed to boot: ${describe(error)}`,
      ErrorCode.CLI_BOOT_FAILED,
      asCause(error),
    );
  }

  if (typeof app.get !== 'function') {
    throw new ApplicationBootError(
      `${entryPath}'s factory did not return a NestJS application`,
      ErrorCode.CLI_BOOT_FAILED,
    );
  }

  const document = await referenceDocument(app, entryPath, closeTimeoutMs);

  return {
    document,
    close: async () => {
      await closeApplication(app, closeTimeoutMs);
    },
  };
}

function bootFactory(moduleExports: Record<string, unknown>): (() => unknown) | undefined {
  if (typeof moduleExports.createApp === 'function') {
    return moduleExports.createApp as () => unknown;
  }
  if (typeof moduleExports.default === 'function') {
    return moduleExports.default as () => unknown;
  }
  return undefined;
}

/**
 * Reads the mounted reference's document off a booted application, closing it first when there
 * is none: an application with nothing to extract has nothing left to do with the connection.
 */
async function referenceDocument(
  app: BootedApplicationLike,
  entryPath: string,
  closeTimeoutMs: number,
): Promise<IRDocument> {
  let references: unknown;
  try {
    references = app.get?.(REFERENCES_TOKEN, { strict: false });
  } catch (error) {
    await closeApplication(app, closeTimeoutMs).catch(() => undefined);
    throw new ApplicationBootError(
      `could not read the mounted reference from ${entryPath}: ${describe(error)}`,
      ErrorCode.CLI_BOOT_FAILED,
      asCause(error),
    );
  }

  const mounted = isMountedReferencesLike(references) ? references.all() : [];
  const document = mounted[0]?.pass?.document;

  if (document === undefined) {
    await closeApplication(app, closeTimeoutMs).catch(() => undefined);
    throw new ApplicationBootError(
      `${entryPath} booted, but OpenRefModule has no document mounted on it`,
      ErrorCode.CLI_BOOT_FAILED,
    );
  }

  return document as IRDocument;
}

/**
 * Closes a booted application, and forces the point rather than waiting on it forever.
 *
 * THE TIMER IS NOT UNREFED. An application that truly hangs leaves nothing else running the
 * event loop, and an unrefed timer never fires under exactly that condition: Node sees no
 * refed work left and exits the process on its own, silently, before the timeout it was meant
 * to detect. The timer is refed so it is guaranteed to fire, and cleared the moment `close`
 * wins the race so a clean shutdown is never held open for the timeout's sake.
 *
 * @throws {ShutdownTimeoutError} When `close` has not settled within `timeoutMs`
 */
async function closeApplication(app: BootedApplicationLike, timeoutMs: number): Promise<void> {
  if (typeof app.close !== 'function') return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolvePromise) => {
    timer = setTimeout(() => {
      resolvePromise('timeout');
    }, timeoutMs);
  });

  try {
    const outcome = await Promise.race([
      Promise.resolve(app.close()).then((): 'closed' => 'closed'),
      timeout,
    ]);

    if (outcome === 'timeout') {
      throw new ShutdownTimeoutError(
        `the application did not close within ${String(timeoutMs)}ms and is being terminated`,
        ErrorCode.CLI_SHUTDOWN_TIMEOUT,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asCause(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined;
}

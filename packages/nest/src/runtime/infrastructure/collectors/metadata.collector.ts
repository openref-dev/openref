/**
 * `scopesCollector()` and `rolesCollector()`, the two metadata collectors of SPEC 6.2.
 *
 * ONE FILE FOR BOTH, BECAUSE THEY ARE ONE MECHANISM WITH TWO TARGETS. Each reads one key off the
 * handler and the controller and puts a list of strings in one field. Two copies of that would be
 * two places for the guarded-and-unreadable rule below to be got wrong in.
 *
 * THE KEY IS REQUIRED AND IS NEVER GUESSED. SPEC 6.1 says only metadata under an explicitly named
 * key is read, and the tempting softening is a list of likely candidates: `SCOPES_KEY`, `scopes`,
 * `permissions`. That is the same guess with a longer spelling, and it fails in the direction that
 * matters, by finding somebody else's key and reporting its contents as this route's policy. A
 * collector built with no key returns a {@link SkippedCollector} and never runs.
 *
 * `getAllAndOverride` RATHER THAN TWO READS, WHICH IS THE OPPOSITE OF WHAT THE GUARDS COLLECTOR
 * DOES, and both are deliberate. A scope decorator on a method replaces the one on the class,
 * because a route requiring `orders:write` inside a controller marked `orders:read` requires
 * `orders:write` and not both. A guard on a method adds to the one on the class, because both run.
 *
 * THE WARNING THIS FILE EXISTS FOR IS THE ONE ABOUT A GUARD THAT COMPUTES ITS POLICY. A route with
 * a guard and nothing under the key is the case SPEC 6.1's first prohibition is about: there is a
 * policy, it is written in code, and it will never be read. Reporting nothing there would be
 * indistinguishable from a route that needs no scopes at all, so the difference is recorded and
 * `doctor` from T022 is what shows it. A route with no guard gets no warning: an absent key there
 * means an absent policy rather than an unreadable one.
 */

import type { IRNodeRuntime } from '@openref/core';
import type {
  CollectorContext,
  IRuntimeCollector,
  SkippedCollector,
} from '../../application/ports/collector.port';
import { readGuards } from '../../domain/guards';

/** The name `scopesCollector` stamps on everything it reports, per SPEC 6.2. */
export const SCOPES_COLLECTOR_NAME = 'scopesCollector';

/** The name `rolesCollector` stamps on everything it reports, per SPEC 6.2. */
export const ROLES_COLLECTOR_NAME = 'rolesCollector';

/** What a host must tell a metadata collector, because it cannot be worked out. */
export interface MetadataCollectorOptions {
  /**
   * The key the application's own decorator writes under.
   *
   * `SetMetadata(SCOPES_KEY, [...])` and `Reflector.createDecorator` both end in a key, and it is
   * the application's key rather than this package's. There is no default and there is no
   * candidate list.
   */
  readonly metadataKey: string | symbol;
}

/** What a metadata collector could not read, kept per node for `doctor`. */
export interface MetadataCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  readonly reason: string;
}

/** A metadata collector, with the record of what it could not read. */
export interface MetadataCollector extends IRuntimeCollector {
  /** Everything that could not be read as a list of strings, in the order it was met. */
  problems(): readonly MetadataCollectorProblem[];
}

/** What a metadata collector may be, since a missing key means it does not run at all. */
export type MetadataCollectorRegistration = MetadataCollector | SkippedCollector;

/**
 * Builds the scopes collector of SPEC 6.2.
 *
 * @param options - The key the application writes its scopes under
 * @returns The collector, or a skip when no usable key was given
 */
export function scopesCollector(options: MetadataCollectorOptions): MetadataCollectorRegistration {
  return metadataCollector(SCOPES_COLLECTOR_NAME, 'scopes', options);
}

/**
 * Builds the roles collector of SPEC 6.2.
 *
 * @param options - The key the application writes its roles under
 * @returns The collector, or a skip when no usable key was given
 */
export function rolesCollector(options: MetadataCollectorOptions): MetadataCollectorRegistration {
  return metadataCollector(ROLES_COLLECTOR_NAME, 'roles', options);
}

/**
 * Builds one metadata collector.
 *
 * @param name - What it is called, and what its facts are attributed to
 * @param field - Which field of `IRNodeRuntime` it fills
 * @param options - The key it reads
 * @returns The collector, or a skip when the key is unusable
 */
function metadataCollector(
  name: string,
  field: 'scopes' | 'roles',
  options: MetadataCollectorOptions,
): MetadataCollectorRegistration {
  const key: unknown = options.metadataKey;

  // A HOST WITHOUT TYPES CAN STILL GET HERE, which is why this is a runtime check and not only a
  // required property. An empty string is the shape a missing constant takes after it has been
  // imported from a module that does not export it, and reading metadata under `''` finds nothing
  // on every route, which is a collector that silently reports no policy anywhere.
  if (!isUsableKey(key)) {
    return {
      name,
      skipped:
        `it was registered without a metadata key, so there is nothing for it to read. ` +
        `Pass ${name}({ metadataKey: YOUR_KEY }) with the key your own decorator writes under; ` +
        'this package never guesses one',
    };
  }

  const problems: MetadataCollectorProblem[] = [];

  return {
    name,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const subject = `${context.declaredOn.name}.${context.handlerName}`;
      const raw: unknown = context.reflector.getAllAndOverride(key, [
        context.handler,
        context.controller,
      ]);

      if (raw === undefined || raw === null) {
        recordUnreadablePolicy(context, subject, key, problems);

        return undefined;
      }

      const values = asStringList(raw);
      if (values === undefined) {
        problems.push({
          subject,
          reason:
            `the metadata under ${describe(key)} is ${typeName(raw)}, and a ${field} fact is a ` +
            'list of strings. Nothing was reported for this route rather than a coerced value',
        });

        return undefined;
      }

      // `derived` AND NEVER HIGHER, per the SPEC 6.1 table, which names metadata under a known key
      // as the example of exactly this level. `declared` belongs to a decorator written to
      // document the route, and this collector cannot tell one of those from an enforcement
      // decorator that happens to be readable.
      return field === 'scopes'
        ? { scopes: context.fact(values, 'derived') }
        : { roles: context.fact(values, 'derived') };
    },

    problems(): readonly MetadataCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Records the case SPEC 6.1's first prohibition is about, and only that case.
 *
 * @param context - What the registry handed over
 * @param subject - The route, as a reader recognises it
 * @param key - The key that was looked for
 * @param problems - Accumulator
 */
function recordUnreadablePolicy(
  context: CollectorContext,
  subject: string,
  key: string | symbol,
  problems: MetadataCollectorProblem[],
): void {
  const guards = readGuards(context.reflector, context.controller, context.handler);
  if (guards.names.length === 0 && guards.anonymous === 0) return;

  const named = guards.names.length > 0 ? guards.names.join(', ') : 'an unnamed guard';

  problems.push({
    subject,
    reason:
      `it is guarded by ${named} and carries no metadata under ${describe(key)}, so whatever ` +
      'policy the guard enforces in code is not in this reference. Guard logic is never read, ' +
      'per SPEC 6.1. Declare the fact with a decorator that writes that key',
  });
}

/**
 * Reports whether a value can be used as a metadata key at all.
 *
 * A symbol always can. A string can when it has characters in it: an empty string is the shape a
 * missing constant takes once it has been imported from a module that does not export it.
 *
 * @param value - Whatever the host passed
 * @returns True when metadata can be read under it
 */
function isUsableKey(value: unknown): value is string | symbol {
  if (typeof value === 'symbol') return true;

  return typeof value === 'string' && value.length > 0;
}

/**
 * Narrows a metadata value to a list of strings.
 *
 * @param value - Whatever was under the key
 * @returns The strings, or undefined when it is not a list of them
 */
function asStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const items: unknown[] = value;

  return items.every((item) => typeof item === 'string') ? items : undefined;
}

/**
 * Renders a key for a message.
 *
 * @param key - The key
 * @returns Its printable form
 */
function describe(key: string | symbol): string {
  return typeof key === 'string' ? `"${key}"` : String(key);
}

/**
 * Names what a value is, for a message that has to say why it was refused.
 *
 * @param value - Whatever was found
 * @returns A short description
 */
function typeName(value: unknown): string {
  if (Array.isArray(value)) return 'a list holding something other than strings';
  if (value === null) return 'null';

  return `a ${typeof value}`;
}

/**
 * `publicRouteCollector()`, the exemption reader of SPEC 6.2.1.
 *
 * WHY IT EXISTS, AND THE ANSWER IS A RULE THAT COULD NOT BE CLEARED. `security-drift` softens to a
 * warning on any route whose only guard is registered under `APP_GUARD`, and that finding says a
 * route level escape may already exempt it, which is a finding whose own text says it may be clean.
 * `edit: 'unscoped-assertion'` classifies to `manual` with `structural-ambiguity`, so no fix mode
 * may touch it at any confidence, and the only edit that removes the row is a security requirement
 * the specification would then be lying about. It therefore stood forever on every deliberately
 * public route of every such application.
 *
 * AND THE RULE'S OWN REASON WAS INACCURATE FOR THE COMMON CASE. It said the decision is inside the
 * guard and unreadable. On the ordinary NestJS escape hatch it is not: the guard reads
 * `getAllAndOverride(KEY, [handler, class])` and lets a marked route through, so the decision is
 * metadata under one key. Metadata under a key the host names is exactly what SPEC 6.1 permits and
 * what five collectors already read; what forbade this one was only that no option existed to name
 * the key.
 *
 * THE KEY IS THE HOST'S, IS NEVER GUESSED AND IS NEVER DEFAULTED, which is the rule
 * `metadata.collector.ts` states at length and this one inherits whole. An application whose key is
 * `'isPublic'` and one whose key is a symbol both work; an application that names nothing behaves
 * exactly as it did before this file existed, because this collector is not built at all.
 *
 * WHAT THE MARK MEANS IS NARROW ON PURPOSE. It says the host asserts this route is exempt from its
 * own application wide guard. It does not say the route is unauthenticated in every sense, and it
 * never silences a guard written on the route: `security-drift` asks about a route scope guard
 * first, so `@UseGuards(AdminGuard)` on a marked handler keeps its error.
 */

import type { IRGuardExemptionSource, IRNodeRuntime } from '@openref/core';
import type {
  CollectorContext,
  IRuntimeCollector,
  SkippedCollector,
} from '../../application/ports/collector.port';

/** The name `publicRouteCollector` stamps on everything it reports, per SPEC 6.2. */
export const PUBLIC_ROUTE_COLLECTOR_NAME = 'publicRouteCollector';

/** What a host must tell this collector, because it cannot be worked out. */
export interface PublicRouteCollectorOptions {
  /**
   * The key the application's own exemption decorator writes under.
   *
   * `SetMetadata(IS_PUBLIC_KEY, true)` and `Reflector.createDecorator()` both end in a key, and it
   * is the application's key rather than this package's. There is no default and no candidate list,
   * for the reason `MetadataCollectorOptions.metadataKey` gives: a candidate list is the same guess
   * with a longer spelling, and it fails by finding somebody else's key and reporting its contents
   * as this route's policy.
   */
  readonly metadataKey: string | symbol;
}

/** What this collector met and could not turn into a fact, kept for `doctor`. */
export interface PublicRouteCollectorProblem {
  /** `OrdersController.list`, or `the application` for a finding about the whole run. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. */
  readonly detail?: string;
}

/** This collector, with the record of what it could not read. */
export interface PublicRouteCollector extends IRuntimeCollector {
  /** Everything it met and could not state, in the order it was met. */
  problems(): readonly PublicRouteCollectorProblem[];
}

/** What it may be, since an unusable key means it does not run at all. */
export type PublicRouteCollectorRegistration = PublicRouteCollector | SkippedCollector;

/**
 * Builds the exemption collector of SPEC 6.2.1.
 *
 * @param options - The key the application's global guard reads its exemption under
 * @returns The collector, or a skip when no usable key was given
 */
export function publicRouteCollector(
  options: PublicRouteCollectorOptions,
): PublicRouteCollectorRegistration {
  const key: unknown = options.metadataKey;

  // A HOST WITHOUT TYPES CAN STILL GET HERE, which is why this is a runtime check as well as a
  // required property. An empty string is the shape a missing constant takes after it has been
  // imported from a module that does not export it, and reading metadata under `''` finds nothing
  // on every route, which is an exemption reader that silently exempts nobody.
  if (!isUsableKey(key)) {
    return {
      name: PUBLIC_ROUTE_COLLECTOR_NAME,
      skipped:
        'it was registered without a metadata key, so there is nothing for it to read. Set ' +
        'runtime.publicRouteKey to the key your own guard reads; this package never guesses one',
    };
  }

  const problems: PublicRouteCollectorProblem[] = [];
  /** Routes this collector was asked about, so an absence below is an absence and not an empty run. */
  let seen = 0;
  /** Routes that carried the mark, which is what makes the declaration live. */
  let marked = 0;

  return {
    name: PUBLIC_ROUTE_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      seen += 1;

      // `getAllAndOverride` WITH THE HANDLER FIRST AND THE CLASS SECOND, WHICH IS HOW THE GUARD
      // ITSELF READS IT. A `@Public()` on the CONTROLLER CLASS exempts every route in that
      // controller, and reading the handler alone would make this package's answer diverge from the
      // application's actual behaviour on exactly the shape a host reaches for when a whole
      // controller is public. The override direction matters too: a `@Public(false)` on a handler
      // inside a marked class is the nearer declaration and wins, which is what the guard does.
      const raw: unknown = context.reflector.getAllAndOverride(key, [
        context.handler,
        context.controller,
      ]);

      if (raw === undefined || raw === null) return undefined;

      // A FUNCTION UNDER THE KEY IS A `doctor` REASON AND NEVER MATERIAL FOR A FACT, per SPEC 6.1.
      // What a function answers is decided by calling it, with a request this pass does not have,
      // so a mark read off one would be a statement about the route that nothing observed.
      if (typeof raw === 'function') {
        problems.push({
          subject: `${context.declaredOn.name}.${context.handlerName}`,
          reason: `the metadata under ${describe(key)} is a function, so whether this route is exempt is not known`,
          action: 'write the value your guard tests, not a function that computes it',
          detail:
            'A function answers only when it is called, with a request this pass does not have, ' +
            'so a mark read off one would be a statement about the route that nothing observed. ' +
            'Guard logic is never read, per SPEC 6.1.',
        });

        return undefined;
      }

      // TRUTHINESS, BECAUSE THAT IS THE TEST THE GUARD APPLIES. The ordinary guard writes
      // `if (isPublic) return true`, so a `false` under the key is not an exemption and neither is
      // an empty string. Reading the presence of the key instead would exempt every route a host
      // had explicitly UN-marked.
      if (raw === false || raw === 0 || raw === '') return undefined;

      marked += 1;

      // `derived` AND NEVER HIGHER, per the SPEC 6.1 table, which names metadata under a known key
      // as the example of exactly this level. `declared` belongs to a decorator written to document
      // the route, and this reads an enforcement decorator that happens to be readable.
      return {
        guardExemption: context.fact({ declaredOn: sourceOf(context, key) }, 'derived'),
      };
    },

    problems(): readonly PublicRouteCollectorProblem[] {
      // A DECLARED KEY THAT MATCHED NO ROUTE IS A DEAD DECLARATION AND IS REPORTED, exactly as a
      // suppression matching nothing is reported with `matched: 0` rather than refusing boot, per
      // SPEC 7.2. A class can be legitimately empty on one deployment; what cannot happen is that a
      // host who mistyped the key gets the same clean report as a host with no public routes.
      //
      // AND THE SUBJECT IS ASSERTED PRESENT BEFORE THE ABSENCE IS CLAIMED. Over zero routes every
      // sentence below is vacuously true, so a run that was asked about nothing says nothing.
      if (seen > 0 && marked === 0) {
        return [
          ...problems,
          {
            subject: 'the application',
            reason: `no route of ${String(seen)} carries metadata under ${describe(key)}, so the exemption key marks nothing`,
            action:
              'pass the key your own decorator writes under, or remove runtime.publicRouteKey',
            detail:
              'Every route was read and none was marked, so security-drift answers exactly as it ' +
              'did before the key was named. A key that matches nothing and a host with no public ' +
              'routes produce the same report, which is why this is recorded rather than left ' +
              'silent.',
          },
        ];
      }

      return problems;
    },
  };
}

/**
 * Which of the two declarations the mark was written on.
 *
 * IT IS ASKED ONLY AFTER THE OVERRIDE HAS ALREADY ANSWERED, so this never decides whether a route
 * is exempt, only where a reader should look. The handler is asked first because that is the one
 * `getAllAndOverride` prefers, so the two answers cannot disagree.
 *
 * @param context - What the registry handed over
 * @param key - The key the host named
 * @returns Where the host wrote it
 */
function sourceOf(context: CollectorContext, key: string | symbol): IRGuardExemptionSource {
  const own: unknown = context.reflector.get(key, context.handler);

  return own === undefined || own === null ? 'controller' : 'handler';
}

/**
 * Reports whether a value can be used as a metadata key at all.
 *
 * @param value - Whatever the host passed
 * @returns True when metadata can be read under it
 */
function isUsableKey(value: unknown): value is string | symbol {
  if (typeof value === 'symbol') return true;

  return typeof value === 'string' && value.length > 0;
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

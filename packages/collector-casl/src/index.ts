/**
 * `@openref/collector-casl`: the abilities an endpoint declares, and nothing it computes.
 *
 * THE HARD PART OF A CASL COLLECTOR IS WHAT IT REFUSES TO DO. The usual CASL integration writes a
 * policy handler, a function of the ability and the request, under a key of the application's own
 * choosing. That function is guard logic, and SPEC 6.1 forbids reading guard logic without
 * qualification, so a function under the key produces no fact at all and a `doctor` reason instead.
 * The temptation is real and it is the whole reason this file has a comment this long: a handler
 * usually looks like `(ability) => ability.can('read', Order)`, and a parser that read the string
 * would be right most of the time and silently wrong the rest, which is worse than silence.
 *
 * WHAT IT DOES READ IS THE DECLARATIVE FORM, per SPEC 6.2.2: a list of action and subject pairs
 * under an explicitly configured key. That is a statement about the route rather than a computation
 * over a request, and it is the shape `@CheckAbilities({ action: 'read', subject: 'Order' })` and
 * its tuple spelling both produce.
 *
 * IT FILLS `scopes` RATHER THAN A FIELD OF ITS OWN. `IRNodeRuntime` has no `abilities`, and adding
 * one would be a change to a frozen contract for a vocabulary difference. `action:subject` is the
 * form the reference already shows for a permission, and it reads the way a scope reads.
 */

import { createRequire } from 'node:module';
import type { IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector, SkippedCollector } from '@openref/nest';

/** Name of this package. */
export const PACKAGE_NAME = '@openref/collector-casl';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const CASL_COLLECTOR_NAME = 'caslCollector';

/** The package this collector exists to read alongside. */
export const CASL_PACKAGE = '@casl/ability';

/** What a host must tell the collector, because it cannot be worked out. */
export interface CaslCollectorOptions {
  /**
   * The key the application's own ability decorator writes under.
   *
   * There is no default and no candidate list, per SPEC 6.1. CASL ships no decorator of its own,
   * so this key belongs to the application in every project.
   */
  readonly metadataKey: string | symbol;

  /** Whether the package is present. Injected by the tests and by nothing else. */
  readonly isInstalled?: () => boolean;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface CaslCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
}

/** The collector, with the record of what it could not read. */
export interface CaslCollector extends IRuntimeCollector {
  problems(): readonly CaslCollectorProblem[];
}

/** What the factory returns, since an absent package means it does not run at all. */
export type CaslCollectorRegistration = CaslCollector | SkippedCollector;

/**
 * Builds the CASL collector of SPEC 6.2.2.
 *
 * @param options - The key it reads, and a seam for the tests
 * @returns The collector, or a skip naming what was missing
 */
export function caslCollector(options: CaslCollectorOptions): CaslCollectorRegistration {
  const key: unknown = options.metadataKey;

  if (typeof key === 'symbol' ? false : typeof key !== 'string' || key.length === 0) {
    return {
      name: CASL_COLLECTOR_NAME,
      skipped:
        'it was registered without a metadata key, so there is nothing for it to read. CASL ships ' +
        'no decorator of its own, so the key belongs to your application and this package never ' +
        'guesses one',
    };
  }

  if (!(options.isInstalled ?? isResolvable)()) {
    return {
      name: CASL_COLLECTOR_NAME,
      skipped: `${CASL_PACKAGE} is not installed, so there are no abilities in this application to report`,
    };
  }

  const problems: CaslCollectorProblem[] = [];

  return {
    name: CASL_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const subject = `${context.declaredOn.name}.${context.handlerName}`;
      const raw: unknown = context.reflector.getAllAndOverride(key, [
        context.handler,
        context.controller,
      ]);

      if (raw === undefined || raw === null) return undefined;

      const entries = Array.isArray(raw) ? (raw as unknown[]) : [raw];
      const abilities: string[] = [];
      let functions = 0;

      for (const entry of entries) {
        if (typeof entry === 'function') {
          functions += 1;
          continue;
        }

        const rendered = renderAbility(entry);
        if (rendered !== undefined && !abilities.includes(rendered)) abilities.push(rendered);
      }

      if (functions > 0) {
        problems.push({
          subject,
          reason: `${String(functions)} policy handler(s) here are functions, so what they allow is not known`,
          action: 'declare the action and the subject as data if they should be in the reference',
          detail:
            'A policy written in code is guard logic, which is never read, per SPEC 6.1. What a ' +
            'function checks is decided at request time against an ability nothing here has.',
        });
      }

      return abilities.length === 0 ? undefined : { scopes: context.fact(abilities, 'derived') };
    },

    problems(): readonly CaslCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Renders one declarative ability as `action:subject`.
 *
 * Both spellings a CASL integration produces are accepted: the object form
 * `{ action, subject }` and the tuple form `['read', 'Order']`. A subject given as a class is
 * named by the class, which is how CASL itself addresses one.
 *
 * @param entry - One entry from the metadata
 * @returns The rendered ability, or undefined when the entry is not one
 */
function renderAbility(entry: unknown): string | undefined {
  if (Array.isArray(entry)) {
    const [action, subject] = entry as unknown[];

    return joinPair(action, subject);
  }

  if (typeof entry === 'object' && entry !== null) {
    const record = entry as { action?: unknown; subject?: unknown };

    return joinPair(record.action, record.subject);
  }

  return undefined;
}

/**
 * Joins an action and a subject, when both can be named.
 *
 * @param action - The action
 * @param subject - The subject, as a string or a class
 * @returns `action:subject`, or undefined when either cannot be named
 */
function joinPair(action: unknown, subject: unknown): string | undefined {
  if (typeof action !== 'string' || action.length === 0) return undefined;

  const named = nameOf(subject);

  return named === undefined ? undefined : `${action}:${named}`;
}

/**
 * Names a subject, which CASL admits as a string or as a class.
 *
 * @param subject - Whatever was given
 * @returns Its name, or undefined
 */
function nameOf(subject: unknown): string | undefined {
  if (typeof subject === 'string') return subject.length === 0 ? undefined : subject;
  if (typeof subject === 'function') return subject.name === '' ? undefined : subject.name;

  return undefined;
}

/**
 * Reports whether CASL is installed, without loading it.
 *
 * THE ENTRY POINT AND NOT THE MANIFEST, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE. The
 * first version resolved `@casl/ability/package.json`, which is the obvious way to ask whether a
 * package is there without running it. `@casl/ability` has an `exports` map that does not list
 * `./package.json`, so Node refuses the path with `ERR_PACKAGE_PATH_NOT_EXPORTED` on a copy that
 * is installed, and the collector reported the library missing on every project that has it. The
 * entry is what an `exports` map always publishes. `resolve` does not run it.
 *
 * @returns True when the package resolves
 */
function isResolvable(): boolean {
  try {
    createRequire(import.meta.url).resolve(CASL_PACKAGE);

    return true;
  } catch {
    return false;
  }
}

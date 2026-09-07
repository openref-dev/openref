/**
 * `@openref/collector-access-control`: the roles a grant declares, and nothing a query computes.
 *
 * SAME REFUSAL AS THE CASL COLLECTOR, FOR THE SAME REASON. An `accesscontrol` integration usually
 * asks the grant table a question at request time, and the question is guard logic. What is
 * readable is the declaration a decorator wrote: a list of grants naming roles, resources,
 * actions and possession. Only the role names come out of it.
 *
 * ONLY THE ROLES, AND THE REST IS DELIBERATELY DROPPED. A grant carries four fields and
 * `IRNodeRuntime.roles` is a list of strings, so the honest reduction is the role names. Rendering
 * `admin:read:own:order` would put a vocabulary this project does not define into a field a reader
 * compares against the specification's security requirements, and the comparison would never
 * match. The dropped detail is not lost quietly: a grant that names no role at all is recorded.
 */

import { createRequire } from 'node:module';
import type { IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector, SkippedCollector } from '@openref/nest';

/** Name of this package. */
export const PACKAGE_NAME = '@openref/collector-access-control';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const ACCESS_CONTROL_COLLECTOR_NAME = 'accessControlCollector';

/** The package this collector exists to read alongside. */
export const ACCESS_CONTROL_PACKAGE = 'accesscontrol';

/** What a host must tell the collector, because it cannot be worked out. */
export interface AccessControlCollectorOptions {
  /**
   * The key the application's own grant decorator writes under.
   *
   * There is no default and no candidate list, per SPEC 6.1.
   */
  readonly metadataKey: string | symbol;

  /** Whether the package is present. Injected by the tests and by nothing else. */
  readonly isInstalled?: () => boolean;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface AccessControlCollectorProblem {
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
export interface AccessControlCollector extends IRuntimeCollector {
  problems(): readonly AccessControlCollectorProblem[];
}

/** What the factory returns, since an absent package means it does not run at all. */
export type AccessControlCollectorRegistration = AccessControlCollector | SkippedCollector;

/**
 * Builds the access control collector of SPEC 6.2.2.
 *
 * @param options - The key it reads, and a seam for the tests
 * @returns The collector, or a skip naming what was missing
 */
export function accessControlCollector(
  options: AccessControlCollectorOptions,
): AccessControlCollectorRegistration {
  const key: unknown = options.metadataKey;

  if (typeof key === 'symbol' ? false : typeof key !== 'string' || key.length === 0) {
    return {
      name: ACCESS_CONTROL_COLLECTOR_NAME,
      skipped:
        'it was registered without a metadata key, so there is nothing for it to read. Pass the ' +
        'key your own grant decorator writes under; this package never guesses one',
    };
  }

  if (!(options.isInstalled ?? isResolvable)()) {
    return {
      name: ACCESS_CONTROL_COLLECTOR_NAME,
      skipped: `${ACCESS_CONTROL_PACKAGE} is not installed, so there are no grants in this application to report`,
    };
  }

  const problems: AccessControlCollectorProblem[] = [];

  return {
    name: ACCESS_CONTROL_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const subject = `${context.declaredOn.name}.${context.handlerName}`;
      const raw: unknown = context.reflector.getAllAndOverride(key, [
        context.handler,
        context.controller,
      ]);

      if (raw === undefined || raw === null) return undefined;

      const entries = Array.isArray(raw) ? (raw as unknown[]) : [raw];
      const roles: string[] = [];
      let functions = 0;
      let roleless = 0;

      for (const entry of entries) {
        if (typeof entry === 'function') {
          functions += 1;
          continue;
        }

        const named = rolesOf(entry);
        if (named.length === 0) {
          roleless += 1;
          continue;
        }

        for (const role of named) if (!roles.includes(role)) roles.push(role);
      }

      if (functions > 0) {
        problems.push({
          subject,
          reason: `${String(functions)} grant(s) here are functions, so the roles they name are not known`,
          action: 'declare the role as data if it should appear in the reference',
          detail:
            'A permission computed in code is guard logic, which is never read, per SPEC 6.1. ' +
            'What a function grants is decided at request time and has no value to read here.',
        });
      }

      if (roleless > 0) {
        problems.push({
          subject,
          reason: `${String(roleless)} grant(s) name no role, so nothing was taken from them`,
          action: 'name the role on the grant if it should appear in the reference',
          detail:
            'A grant that names only a resource and an action says who may not do it rather ' +
            'than who may, and the reference reports who may.',
        });
      }

      return roles.length === 0 ? undefined : { roles: context.fact(roles, 'derived') };
    },

    problems(): readonly AccessControlCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Takes the role names out of one grant.
 *
 * A grant names one role or several, and `accesscontrol` accepts both spellings. A bare string is
 * accepted too, which is what an application writes when its decorator carries roles and nothing
 * else.
 *
 * @param entry - One entry from the metadata
 * @returns Its role names, which may be empty
 */
function rolesOf(entry: unknown): readonly string[] {
  if (typeof entry === 'string') return entry.length === 0 ? [] : [entry];

  if (typeof entry === 'object' && entry !== null) {
    const role: unknown = (entry as { role?: unknown }).role;

    if (typeof role === 'string') return role.length === 0 ? [] : [role];
    if (Array.isArray(role)) {
      const items: unknown[] = role;

      return items.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
  }

  return [];
}

/**
 * Reports whether the package is installed, without loading it.
 *
 * THE ENTRY POINT AND NOT THE MANIFEST, for the reason written out in the CASL collector: a
 * package whose `exports` map does not list `./package.json` refuses that path on a copy that is
 * installed, so asking for the manifest reports every such library missing. `accesscontrol` does
 * publish its manifest and would have worked either way, which is exactly why both are written the
 * same: the one that would break is not the one anybody tests first. `resolve` does not run it.
 *
 * @returns True when the package resolves
 */
function isResolvable(): boolean {
  try {
    createRequire(import.meta.url).resolve(ACCESS_CONTROL_PACKAGE);

    return true;
  } catch {
    return false;
  }
}

/**
 * `errorsCollector({ catalogs, global })`, which builds the two groups of SPEC 6.4 a person writes.
 *
 * TWO OF THE THREE GROUPS AND DELIBERATELY NOT THE THIRD. `declared` comes from `@ApiErrors` on a
 * route, `global` from what the host says the whole application can answer with, and both are
 * statements somebody made on purpose. The third group is derived from facts other collectors
 * produced, so it is filled after the merge by `withRuntimeErrorContracts` in `core`; a collector
 * that read another collector's output would make the result depend on registration order, which
 * SPEC 6.2 forbids and has a test for.
 *
 * A STATUS CANNOT BE TAKEN OUT OF A CLASS, AND THE TWO TEMPTING WAYS OF TAKING ONE ARE BOTH
 * REFUSED. Constructing the class to ask it is running the application's code during a
 * documentation build, and an error constructor is free to open a connection or read a request
 * that is not there. Reading the name is the guess with a candidate list that SPEC 6.2.1 refuses in
 * so many words: `NotFoundError` is 404 until somebody's `NotFoundError` means their cache missed.
 * So the host says it, in a catalog, or the class carries a static `status`, and a class that does
 * neither produces a `doctor` problem rather than a contract with an invented number.
 *
 * THE `declared` LEVEL IS RIGHT HERE FOR THE SAME REASON IT IS RIGHT IN `declarationsCollector`.
 * `@ApiErrors` exists for no purpose other than documenting the route, so what it says is a
 * promise, and a promise outranks an observation whatever order the two were registered in.
 */

import {
  groupErrorContracts,
  problemDetailsSchema,
  type IRErrorContract,
  type IRNodeRuntime,
} from '@openref/core';
import { OPENREF_METADATA } from '../../../api/decorators/metadata';
import type { CollectorContext, IRuntimeCollector } from '../../application/ports/collector.port';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const ERRORS_COLLECTOR_NAME = 'errorsCollector';

/**
 * What an error class answers with, as the host states it.
 *
 * `status` IS THE ONLY REQUIRED MEMBER because it is the only one that cannot be restated from
 * something already in hand: `title` falls back to the class name, which is the name the
 * declaration itself used, and RFC 9457 makes every other member optional.
 */
export interface ErrorCatalogEntry {
  /** HTTP status this error is answered with. */
  readonly status: number;
  /** RFC 9457 `title`. Defaults to the class name. */
  readonly title?: string;
  /** RFC 9457 `type` URI. */
  readonly type?: string;
  /** RFC 9457 `detail`, when one sentence covers every occurrence. */
  readonly detail?: string;
}

/**
 * A catalog: the application's error classes, each with what it answers with.
 *
 * KEYED BY THE CLASS AND NOT BY ITS NAME. Two modules may each export a `ConflictError`, and a
 * catalog keyed by name would answer for the wrong one silently. A plain object literal is accepted
 * as well, because that is what a host writes, and there the key is the class name; it is the
 * second choice and the map is the one to reach for when a name could collide.
 */
export type ErrorCatalog =
  ReadonlyMap<unknown, ErrorCatalogEntry> | Readonly<Record<string, ErrorCatalogEntry>>;

/** What `errorsCollector` accepts, per SPEC 6.2 and 6.4. */
export interface ErrorsCollectorOptions {
  /** Catalogs consulted in order, first hit wins. */
  readonly catalogs?: readonly ErrorCatalog[];
  /**
   * Contracts every operation of this application can answer with, per SPEC 6.4.
   *
   * DECLARED BY THE HOST AND NEVER OBSERVED. A globally registered exception filter says how an
   * error is rendered if one reaches the top, not that any endpoint produces one, so reading the
   * filter list would produce a claim nothing supports. A host that wants to say "anything here can
   * answer 500 in problem+json" says it here.
   */
  readonly global?: readonly ErrorCatalogEntry[];
}

/** An `@ApiErrors` entry that could not become a contract, kept per node for `doctor`. */
export interface ErrorsCollectorProblem {
  /** `OrdersController.read`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
}

/** The collector, with the record of the declarations it could not resolve. */
export interface ErrorsCollector extends IRuntimeCollector {
  /** Declarations that were present and unresolvable, in the order they were met. */
  problems(): readonly ErrorsCollectorProblem[];
}

/**
 * Builds the errors collector of SPEC 6.2.
 *
 * @param options - Catalogs to resolve declared classes through, and the application wide list
 * @returns The collector
 */
export function errorsCollector(options: ErrorsCollectorOptions = {}): ErrorsCollector {
  const problems: ErrorsCollectorProblem[] = [];
  const catalogs = options.catalogs ?? [];
  const global = (options.global ?? []).map((entry, index) =>
    contractOf(entry, entry.title ?? `Error ${String(index + 1)}`, 'global'),
  );

  return {
    name: ERRORS_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const subject = `${context.declaredOn.name}.${context.handlerName}`;
      const declared = readDeclaredErrors(context).map((entry) =>
        resolve(entry, catalogs, subject, problems),
      );
      const usable = declared.filter((contract): contract is IRErrorContract => contract !== null);

      // THE FIELD IS EMITTED WHENEVER THIS COLLECTOR RAN ON A NODE, AND THE GROUPS INSIDE IT MAY
      // BE EMPTY. That is SPEC 6.4's own distinction: an absent `errors` means nobody was asked,
      // while a present and empty `declared` group means the route was examined and carries no
      // declaration. An operation with a global filter over it and nothing of its own lands here,
      // with an empty group rather than an invented one.
      return { errors: groupErrorContracts([...usable, ...global]) };
    },

    problems(): readonly ErrorsCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Reads `@ApiErrors`, from the handler or from the controller.
 *
 * `getAllAndOverride`, SO A METHOD REPLACES A CLASS. A controller declaring a common error with one
 * route declaring its own means that route answers with its own, which is what applying the second
 * decorator says. A route wanting both applies both on the method.
 *
 * @param context - What the registry handed over
 * @returns Whatever the decorator stored, as given
 */
function readDeclaredErrors(context: CollectorContext): readonly unknown[] {
  const raw: unknown = context.reflector.getAllAndOverride(OPENREF_METADATA.errors, [
    context.handler,
    context.controller,
  ]);

  return Array.isArray(raw) ? (raw as unknown[]) : [];
}

/**
 * Turns one declared class into a contract, or records why it could not be one.
 *
 * @param entry - Whatever was passed to `@ApiErrors`
 * @param catalogs - Catalogs to consult, in order
 * @param subject - The route, as a reader recognises it
 * @param problems - Accumulator
 * @returns The contract, or null when nothing said what status it answers with
 */
function resolve(
  entry: unknown,
  catalogs: readonly ErrorCatalog[],
  subject: string,
  problems: ErrorsCollectorProblem[],
): IRErrorContract | null {
  const name = classNameOf(entry);

  if (name === undefined) {
    problems.push({
      subject,
      reason: `@ApiErrors was applied with ${describe(entry)}, so no error contract is known`,
      action: 'pass the classes themselves: @ApiErrors(NotFoundError)',
      detail:
        'A contract is built from an error class, which is where the status and the title are ' +
        'read from. Nothing else carries them.',
    });

    return null;
  }

  const found = lookUp(entry, name, catalogs) ?? staticStatusOf(entry);
  if (found === undefined) {
    problems.push({
      subject,
      reason: `nothing says what status ${name} answers with, so no contract was built for it`,
      action:
        `add ${name} to a catalog passed as errorsCollector({ catalogs }), or give it a static ` +
        'status',
      detail:
        'A status is never taken from a class name, per SPEC 6.1: a class called NotFoundError ' +
        'is a name and not a declaration, and reading 404 out of it would be a guess printed as ' +
        'a fact.',
    });

    return null;
  }

  return contractOf(found, name, 'declared');
}

/**
 * Finds an entry in the catalogs, by class first and by name second.
 *
 * @param entry - The class as declared
 * @param name - Its name, for the object form
 * @param catalogs - Catalogs to consult, in order
 * @returns The first hit, or undefined
 */
function lookUp(
  entry: unknown,
  name: string,
  catalogs: readonly ErrorCatalog[],
): ErrorCatalogEntry | undefined {
  for (const catalog of catalogs) {
    if (catalog instanceof Map) {
      const hit: unknown = catalog.get(entry);
      if (isCatalogEntry(hit)) return hit;
      continue;
    }

    const hit: unknown = (catalog as Record<string, unknown>)[name];
    if (isCatalogEntry(hit)) return hit;
  }

  return undefined;
}

/**
 * Reads a static `status` off the class, which is the second level of SPEC 6.4.
 *
 * A STATIC FIELD IS A DECLARATIVE VALUE UNDER A KNOWN NAME, which is the same kind of thing a
 * metadata key is, and reading it is not running anything: the class object already exists. What is
 * refused is everything beyond it, so a class with a `status` and no `title` gets its name as the
 * title rather than a second read into whatever else it happens to carry.
 *
 * @param entry - The class as declared
 * @returns The entry, or undefined when it carries no usable status
 */
function staticStatusOf(entry: unknown): ErrorCatalogEntry | undefined {
  if (typeof entry !== 'function') return undefined;

  const status: unknown = (entry as { status?: unknown }).status;
  if (typeof status !== 'number' || !Number.isInteger(status)) return undefined;

  return { status };
}

/**
 * Builds one contract from a catalog entry.
 *
 * @param entry - What the host stated
 * @param fallbackTitle - The class name, used when no title was given
 * @param origin - Which group it belongs to
 * @returns The contract, carrying the RFC 9457 body as an inline schema
 */
function contractOf(
  entry: ErrorCatalogEntry,
  fallbackTitle: string,
  origin: 'declared' | 'global',
): IRErrorContract {
  const base = {
    status: entry.status,
    title: entry.title ?? fallbackTitle,
    ...(entry.type === undefined ? {} : { type: entry.type }),
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    origin,
    // BOTH GROUPS ARE `declared`, AND THAT IS NOT A SHORTCUT. SPEC 6.1 puts an explicit decorator
    // at that level, and a list the host wrote into its own module options is the same kind of
    // statement: a person wrote it in order to document the application. What separates the two
    // groups is scope, not provenance, and the group is what carries the scope.
    confidence: 'declared' as const,
    collector: ERRORS_COLLECTOR_NAME,
  };

  return {
    ...base,
    schema: {
      kind: 'inline',
      schema: {
        id: `problem-${String(entry.status)}`,
        dialect: 'json-schema-2020-12',
        normalized: problemDetailsSchema(base),
      },
    },
  };
}

/**
 * Reports whether a value can be used as a catalog entry.
 *
 * @param value - Whatever the catalog held
 * @returns True when it carries an integer status
 */
function isCatalogEntry(value: unknown): value is ErrorCatalogEntry {
  if (typeof value !== 'object' || value === null) return false;

  const status: unknown = (value as { status?: unknown }).status;

  return typeof status === 'number' && Number.isInteger(status);
}

/**
 * Names the class a declaration referred to.
 *
 * @param entry - Whatever was passed to `@ApiErrors`
 * @returns The class name, or undefined when it is not a named class
 */
function classNameOf(entry: unknown): string | undefined {
  return typeof entry === 'function' && entry.name !== '' ? entry.name : undefined;
}

/**
 * Names what a value is, for a message that has to say why it was refused.
 *
 * @param value - Whatever was declared
 * @returns A short description
 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'function') return 'an anonymous class';

  return `a ${typeof value}`;
}

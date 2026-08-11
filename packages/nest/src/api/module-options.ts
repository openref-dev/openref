/**
 * The option surface of `OpenRefModule.forRoot`, per SPEC 13.2.
 *
 * WHAT IS HERE AND WHAT IS NOT. SPEC 13.2 prints the whole form, across every milestone: a
 * runner, federation, an agent, `devWatch`. This file carries the parts M1 has built and refuses
 * the rest by name, because an option that is accepted and ignored is the defect class SPEC 0
 * calls "measured but never asserted" wearing a different hat. A host that writes
 * `runner: { mode: 'same-origin' }` today and reads the specification is entitled to believe it
 * did something, and the only honest answer until M2 is an error that says which milestone owns
 * it.
 *
 * THE DIFFERENCE BETWEEN `setup` AND `forRoot`, STATED ONCE, HERE, BECAUSE IT IS NOT WHAT IT
 * LOOKS LIKE. `setup` is SPEC 13.1's one line: it takes the application and mounts one document,
 * synchronously, before `listen`. `forRoot` is a real NestJS module, and what it contributes is
 * the container: it is the only place `DiscoveryService` can be injected, and that service is the
 * only public route to the controller classes every fact of SPEC 6 hangs off.
 *
 * SO THE TWO COMPOSE RATHER THAN COMPETE, and the reason is a constraint of NestJS itself rather
 * than a preference. `SwaggerModule.createDocument(app, ...)` needs the application, so the
 * document does not exist until after `NestFactory.create` has returned, which is strictly after
 * the moment a module's `imports` array is evaluated. A `forRoot` that demanded the document up
 * front would therefore be unusable by the flow every NestJS application already has. The
 * arrangement instead is:
 *
 * - `imports: [OpenRefModule.forRoot({ runtime: { collectors, sourceLink } })]`, which registers
 *   the pass and mounts nothing
 * - `OpenRefModule.setup('/docs', app, { document })` after the document exists, which mounts it
 *   and picks the pass up from the container
 *
 * `documents` stays, for the host that does have its document at definition time: one read from
 * disk, generated at build time, or written by hand. It is optional, and a `forRoot` carrying
 * only `runtime` is the ordinary case rather than a degenerate one.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';
import type { CollectorRegistration } from '../runtime/application/ports/collector.port';
import type { OpenRefSetupOptions } from './reference-options';

/**
 * Who the reference is for, per SPEC 13.2 and `@ApiAudience`.
 *
 * REFUSED WHEN IT IS NOT `public`, UNTIL `TX-VIS` SHIPS THE GUARD. The option exists here because
 * SPEC 13.2 puts it here and because T014 relocated it out of the browser entry, and the guard
 * that makes a non public reference actually non public is a separate scheduled entry. Accepting
 * `internal` and serving the reference to anyone who asks would be worse than not offering the
 * option: the host would have configured a private reference, read no error, and shipped a public
 * one. Fail closed is the policy for anything security shaped, per STANDARDS 8.
 */
export type OpenRefVisibility = 'public' | 'partner' | 'internal';

/** One mounted document. */
export interface OpenRefDocumentOptions extends OpenRefSetupOptions {
  /**
   * Stable identifier for this document, which federation and the CLI address it by.
   *
   * Required, and not defaulted from the route: a route may change without the document being a
   * different document, and an id derived from a route would silently rename it when it did.
   */
  readonly id: string;
  /** Where to mount it, such as `/docs`. */
  readonly route: string;
  /** Who it is for. Defaults to `public`. */
  readonly visibility?: OpenRefVisibility;
}

/** The runtime intelligence surface of SPEC 6, which is what `forRoot` exists for. */
export interface OpenRefRuntimeOptions {
  /** The collectors of SPEC 6.2, in the order they should contribute. */
  readonly collectors?: readonly CollectorRegistration[];
  /** Deep link template of SPEC 6.3, such as `https://host/blob/{ref}/{file}#L{line}`. */
  readonly sourceLink?: string;
  /** Whether the health route of SPEC 13.3 answers. Defaults to true. */
  readonly health?: boolean;
}

/** Everything `forRoot` accepts. */
export interface OpenRefRootOptions {
  /**
   * Documents to mount at bootstrap, for a host that already has them.
   *
   * Optional, per the note at the top of this file: a document built by `SwaggerModule` does not
   * exist yet when this is read, and that host calls `setup` afterwards instead.
   */
  readonly documents?: readonly OpenRefDocumentOptions[];
  /** Runtime intelligence, per SPEC 6. */
  readonly runtime?: OpenRefRuntimeOptions;
}

/** The async form SPEC 13.2 calls mandatory. */
export interface OpenRefRootAsyncOptions {
  /** Modules whose providers the factory injects. */
  readonly imports?: readonly unknown[];
  /** Builds the options, from configuration a host holds in a provider. */
  readonly useFactory: (...args: never[]) => OpenRefRootOptions | Promise<OpenRefRootOptions>;
  /** Provider tokens handed to the factory, in order. */
  readonly inject?: readonly unknown[];
}

/** Options SPEC 13.2 prints that a later milestone owns, and which milestone that is. */
const NOT_YET_BUILT: Readonly<Record<string, string>> = {
  theme: 'M2, T031',
  runner: 'M2, T026 through T030',
  federation: 'M4',
  agent: 'M6, T058',
  cache: 'M0, and it is per document rather than global: pass it in a documents entry',
  devWatch: 'M3',
};

/**
 * Checks the options before anything is built from them.
 *
 * @param options - Whatever the host passed to `forRoot`
 * @throws {InvalidOptionsError} When an entry is incomplete, duplicated, or names an unbuilt option
 */
export function assertRootOptions(options: OpenRefRootOptions): void {
  const documents: readonly OpenRefDocumentOptions[] = Array.isArray(options.documents)
    ? options.documents
    : [];

  for (const [key, owner] of Object.entries(NOT_YET_BUILT)) {
    if (key in options) {
      throw invalid(
        `the ${key} option of SPEC 13.2 is not built yet, it belongs to ${owner}. It is refused ` +
          'rather than ignored, so that a host never configures something that does nothing',
      );
    }
  }

  const ids = new Set<string>();
  const routes = new Set<string>();

  for (const entry of documents) {
    if (typeof entry.id !== 'string' || entry.id === '') {
      throw invalid('every entry in documents needs a non empty id');
    }
    if (ids.has(entry.id)) {
      throw invalid(`two documents share the id "${entry.id}", so neither can be addressed`);
    }
    ids.add(entry.id);

    if (typeof entry.route !== 'string' || entry.route === '') {
      throw invalid(`the document "${entry.id}" needs a route to be mounted on`);
    }
    if (routes.has(entry.route)) {
      throw invalid(
        `two documents are mounted on "${entry.route}", and the second would never be reached`,
      );
    }
    routes.add(entry.route);

    assertVisibility(entry);
  }
}

/**
 * Refuses a visibility this build cannot honour.
 *
 * @param entry - One document entry
 * @throws {InvalidOptionsError} When visibility is set to anything but `public`
 */
function assertVisibility(entry: OpenRefDocumentOptions): void {
  const visibility = entry.visibility ?? 'public';
  if (visibility === 'public') return;

  throw invalid(
    `the document "${entry.id}" asks for visibility "${visibility}", and the guard that would ` +
      'enforce it is not built yet: it is the scheduled entry TX-VIS, positioned after T023. ' +
      'The option is refused rather than accepted, because accepting it would serve a reference ' +
      'to everyone while the host believed it was private',
  );
}

/**
 * The error every refusal above raises.
 *
 * @param message - What is wrong, phrased for whoever wrote the module options
 * @returns The error to throw
 */
function invalid(message: string): InvalidOptionsError {
  return new InvalidOptionsError(message, ErrorCode.CONFIG_INVALID_OPTIONS);
}

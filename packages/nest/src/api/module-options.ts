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
import { assertVisibility } from '../visibility/application/services/admission.service';
import type { CollectorRegistration } from '../runtime/application/ports/collector.port';
import type { OpenRefThemeOptions } from '../reference/application/services/reference.service';
import type { OpenRefSetupOptions } from './reference-options';

/**
 * Who the reference is for, per SPEC 13.2 and `@ApiAudience`.
 *
 * DECLARED IN `visibility/domain/visibility.ts` SINCE `TX-VIS`, beside the guard that enforces it
 * and beside the default, and re-exported here because this is where the option surface is written
 * down and where a reader of `forRoot` looks for it. It stopped living here when it stopped being a
 * `forRoot` option alone: `setup` carries the same pair, per SPEC 13.2.
 */
export type { OpenRefVisibility } from '../visibility/domain/visibility';

/**
 * One mounted document.
 *
 * `visibility` AND `guard` ARE INHERITED RATHER THAN DECLARED HERE, from `OpenRefSetupOptions`, so
 * the two forms of SPEC 13 cannot drift apart on a security option.
 */
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
}

/**
 * The deep link of SPEC 6.3, when the revision has to be given rather than read.
 *
 * THE OBJECT FORM EXISTS FOR THE BUILD THAT HAS NO `.git`, which is most container images: the
 * tree is copied in, the git directory is not, and `git rev-parse` has nothing to answer with. The
 * revision is then known to the pipeline and to nobody else, so it is passed in. Everywhere else
 * the string form is the one to use and the revision is read from the repository.
 */
export interface OpenRefSourceLink {
  /**
   * Template holding `{ref}`, `{file}`, `{line}`, `{absolutePath}` and `{column}`, per SPEC 6.3.
   *
   * THE FORGE FORM AND THE EDITOR FORM ARE ONE TEMPLATE AND THE HOST PICKS WHICH, per SPEC 6.3's
   * decision that the choice belongs to whoever renders the page rather than to whoever reads it.
   * `https://github.com/org/repo/blob/{ref}/{file}#L{line}` is the reference served to a team;
   * `vscode://file/{absolutePath}:{line}:{column}` is the reference read on the machine that built
   * it, and it needs no git, no push and no forge.
   *
   * THE EDITOR FORM ALSO NEEDS `sourceCollector({ absolutePath: true })`, which is the other half
   * of the opt in and is off by default. Without it the template produces no link and says so,
   * rather than the absolute path of a build machine reaching every reader of the page.
   */
  readonly template: string;
  /** The git revision, when it cannot be read from the build environment. */
  readonly ref?: string;
}

/** The runtime intelligence surface of SPEC 6, which is what `forRoot` exists for. */
export interface OpenRefRuntimeOptions {
  /** The collectors of SPEC 6.2, in the order they should contribute. */
  readonly collectors?: readonly CollectorRegistration[];
  /**
   * Deep link template of SPEC 6.3, such as `https://host/blob/{ref}/{file}#L{line}`.
   *
   * A string is the template with the revision read from git. See {@link OpenRefSourceLink} for
   * when to give the revision instead.
   */
  readonly sourceLink?: string | OpenRefSourceLink;
  /**
   * Which security scheme each guard class stands for, per SPEC 13.2.
   *
   * THERE IS NO DEFAULT AND NONE IS GUESSED, for the reason SPEC 7.1 gives. `security-drift` in
   * its contradiction state asks whether the document points at the right scheme, and `JwtAuthGuard`
   * is a class name rather than a scheme name: deriving one from the other would be the guess SPEC
   * 6.1 refuses. Without this the rule reports only the silence state, which needs no mapping.
   */
  readonly guardSecuritySchemes?: Readonly<Record<string, string>>;
  /** Whether the health route of SPEC 13.3 answers. Defaults to true. */
  readonly health?: boolean;
}

/**
 * Reads either form of `sourceLink` into one shape.
 *
 * @param sourceLink - Whatever the host configured
 * @returns The template and the revision it was given, or undefined when nothing was configured
 * @throws {InvalidOptionsError} When the object form carries no template
 */
export function readSourceLink(
  sourceLink: string | OpenRefSourceLink | undefined,
): OpenRefSourceLink | undefined {
  if (sourceLink === undefined) return undefined;
  if (typeof sourceLink === 'string') {
    if (sourceLink === '') {
      throw invalid('runtime.sourceLink is an empty string, which links nothing. Omit it instead');
    }
    return { template: sourceLink };
  }

  if (typeof sourceLink.template !== 'string' || sourceLink.template === '') {
    throw invalid('runtime.sourceLink was given as an object, so it needs a non empty template');
  }

  return sourceLink.ref === undefined
    ? { template: sourceLink.template }
    : { template: sourceLink.template, ref: sourceLink.ref };
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
  /**
   * The theme every mounted document defaults to, per SPEC 13.2. Built since T033.
   *
   * An entry of `documents` that names its own theme overrides this for that mount alone,
   * which is the same relation every other shared option has to its per document form.
   */
  readonly theme?: OpenRefThemeOptions;
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

/**
 * Options SPEC 13.2 prints that a later milestone owns, and which milestone that is.
 *
 * `theme` left this list at T033, where it was built. `runner` stays with a corrected owner:
 * the console it once stood for shipped across M2, and the proxy tuning arrived as the `proxy`
 * option, so what this aggregate name still promises is the reconciliation with SPEC 13.2's
 * shape plus the `socket` and `bridge` halves, which are M6.
 */
const NOT_YET_BUILT: Readonly<Record<string, string>> = {
  runner:
    'T034 reconciles this aggregate with SPEC 13.2: the console shipped across M2, proxy ' +
    'tuning is the proxy option, and the socket and bridge halves are M6',
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

    // Checked here as well as at mount, and the two are different moments on purpose: this one
    // fires while `forRoot` is being evaluated, before the container exists, so a document asking
    // for a visibility it cannot honour never reaches a route table at all.
    assertVisibility(`the document "${entry.id}"`, entry);
  }

  // Checked here rather than where it is used, so a malformed template is an error at boot rather
  // than a document that renders with no links and no explanation.
  readSourceLink(options.runtime?.sourceLink);
  assertGuardSecuritySchemes(options.runtime?.guardSecuritySchemes);
}

/**
 * Refuses a guard to scheme mapping that would silently do nothing.
 *
 * AN EMPTY SCHEME NAME IS THE CASE WORTH REFUSING. It reads as "this guard maps to nothing", which
 * is what leaving the guard out of the map already says, and `security-drift` comparing against an
 * empty string would report every operation as pointing at the wrong scheme.
 *
 * @param mapping - Whatever the host configured, if anything
 * @throws {InvalidOptionsError} When a guard name or a scheme name is empty
 */
function assertGuardSecuritySchemes(mapping: Readonly<Record<string, string>> | undefined): void {
  if (mapping === undefined) return;

  for (const [guard, scheme] of Object.entries(mapping)) {
    if (guard === '' || typeof scheme !== 'string' || scheme === '') {
      throw invalid(
        'runtime.guardSecuritySchemes maps a guard to an empty security scheme name. A guard ' +
          'that stands for no scheme is left out of the map instead, which is what says so',
      );
    }
  }
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

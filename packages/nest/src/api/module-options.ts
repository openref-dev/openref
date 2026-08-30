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

import type { AgentOptions } from '@openref/agent';
import { ErrorCode, InvalidOptionsError } from '@openref/core';
import type { IRServer } from '@openref/core';
import type {
  FederationConflictMode,
  FederationFailureMode,
  IFederationCacheDriver,
} from '@openref/federation';
import { assertAgentOptions } from '../agent/domain/agent-mount';
import { assertBridgeOptions } from '../bridge/domain/bridge-options';
import { assertVisibility } from '../visibility/application/services/admission.service';
import type { EventServerOptions } from '../events/domain/asyncapi-synthesis';
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

/** What every mounted document carries, whoever produced the document itself. */
interface OpenRefMountOptions {
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
 * One mounted document the host hands over.
 *
 * `visibility`, `guard` AND `bridge` ARE INHERITED RATHER THAN DECLARED HERE, from
 * `OpenRefSetupOptions`, so the two forms of SPEC 13 cannot drift apart on a security option.
 */
export type OpenRefHandedDocumentOptions = WithMount<OpenRefSetupOptions>;

/**
 * Puts the mount pair on each arm of an options union.
 *
 * The same distribution `WithSetupBase` performs, and there for the same reason: an intersection
 * written flat over a union collapses the arms and takes SPEC 14.8's bridge ban with them.
 */
type WithMount<T> = T extends unknown ? T & OpenRefMountOptions : never;

/**
 * The setup options without the document, arm by arm.
 *
 * `Omit` IS NOT DISTRIBUTIVE AND THAT MATTERS HERE. `Omit<A | B, 'document'>` keys itself off
 * `keyof (A | B)`, which is the intersection of the two key sets, so the two arms come back as one
 * flattened object and the bridge ban is gone from it. Applying it per arm keeps the union.
 */
type WithoutDocument<T> = T extends unknown ? Omit<T, 'document'> : never;

/**
 * One events document, synthesized from the running application, per SPEC 8.3 and SPEC 13.2.
 *
 * IT CARRIES NO `document`, AND THAT IS THE WHOLE DIFFERENCE. SPEC 13.2 prints this entry as
 * `{ id: 'events', route: '/docs/events', kind: 'events' }`, with no document beside it, because
 * there is no file: the channels are read out of the container at boot from `@MessagePattern`,
 * `@EventPattern`, `@WebSocketGateway` and this package's own `@ApiChannel`. A `document` member
 * on this shape would be a second source for one reference, and the type is what keeps the two
 * apart rather than a check inside the mount.
 *
 * IT IS `forRoot` ONLY, AND NOT `setup`, FOR THE REASON `forRoot` EXISTS AT ALL. Discovering the
 * channels needs `DiscoveryService`, the container is the only place it comes from, and `setup`
 * is not a module. A host whose events live in a file passes it as an ordinary `document`, which
 * this package reads with the AsyncAPI reader because the file says `asyncapi` at its root.
 */
export type OpenRefEventsDocumentOptions = EventsEntry<WithoutDocument<OpenRefSetupOptions>>;

/**
 * Puts the mount pair and the events members on each arm.
 *
 * WRITTEN AS ONE DISTRIBUTION AND NOT AS TWO INTERSECTIONS, because an intersection applied to a
 * union outside a distribution is where the arms collapse again, and a collapsed arm is SPEC
 * 14.8's ban silently gone from the events entry alone.
 */
type EventsEntry<T> = T extends unknown
  ? T & OpenRefMountOptions & OpenRefEventsDocumentParts
  : never;

/** What an events entry carries beyond the shared mount options. */
interface OpenRefEventsDocumentParts {
  /** Says the document is the application's events rather than a document handed over. */
  readonly kind: 'events';
  /** Title of the synthesized document. Defaults to the entry's id. */
  readonly title?: string;
  /** Version of the synthesized document. Defaults to `runtime`, which says what it is. */
  readonly version?: string;
  readonly description?: string;
  /**
   * The brokers the application's microservices are reachable at, per SPEC 8.3.
   *
   * ONE ENTRY PER PROTOCOL, AND WITHOUT IT A PROTOCOL HAS NO ADDRESS. The application knows which
   * transport each handler answers on and cannot know the host a reader would reach it at, so a
   * protocol nothing is configured for still appears, with an empty host, and `doctor` names it.
   */
  readonly servers?: readonly EventServerOptions[];
  /**
   * Schemas a `@ApiMessage` payload class may name, as a `components.schemas` object.
   *
   * Usually the `components.schemas` of the document the HTTP side already builds, so one set of
   * DTO descriptions serves both halves of the reference.
   */
  readonly schemas?: Readonly<Record<string, unknown>>;
}

/** One entry of `documents`: a document handed over, or the application's own events. */
export type OpenRefDocumentOptions = OpenRefHandedDocumentOptions | OpenRefEventsDocumentOptions;

/**
 * Whether one entry is the events form.
 *
 * @param entry - One entry of `documents`
 * @returns True when the entry asks for a synthesized events document
 */
export function isEventsDocument(
  entry: OpenRefDocumentOptions,
): entry is OpenRefEventsDocumentOptions {
  // READ AS `unknown` BECAUSE THE HOST IS NOT THE COMPILER. Narrowing on the presence of the key
  // alone would say yes to `{ kind: 'http', document }`, which a host can write in JavaScript and
  // which would then be mounted as a synthesized events document with no document at all.
  const kind: unknown = (entry as { readonly kind?: unknown }).kind;
  return kind === 'events';
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

/** One federated remote, as SPEC 15 configures it. */
export interface OpenRefFederationRemoteOptions {
  /** Identity of the service, under the merge service id grammar. */
  readonly id: string;
  /** Where the remote's specification is fetched from. `http` or `https` only. */
  readonly url: string;
  /** Path prefix the service is mounted under, such as `/billing`. */
  readonly prefix?: string;
}

/** One local service of the federation: a `documents` entry of this same `forRoot`, by id. */
export interface OpenRefFederationLocalOptions {
  /** The `documents` entry id whose augmented document joins the merge, per SPEC 15.3. */
  readonly id: string;
  /** Path prefix the service is mounted under, such as `/billing`. */
  readonly prefix?: string;
}

/**
 * The federation of SPEC 15, mounted as one more reference.
 *
 * IT SERVES EVERYTHING BUT `document`, which is what the lifecycle produces: the remotes are
 * fetched and polled per SPEC 15.2, the locals are this `forRoot`'s own mounted documents with
 * their runtime facts and health per SPEC 15.3, and the route answers the snapshot's own
 * decision, 200 or 503.
 */
export type OpenRefFederationOptions = FederationEntry<WithoutDocument<OpenRefSetupOptions>>;

/** Puts the federation members on each arm, per the note on {@link EventsEntry}. */
type FederationEntry<T> = T extends unknown ? T & OpenRefFederationParts : never;

/** What a federation entry carries beyond the shared mount options. */
interface OpenRefFederationParts {
  /** Where the federated reference is mounted, such as `/docs`. */
  readonly route: string;
  /** `IRDocument.id` of the merged document, which the CLI addresses it by. */
  readonly id: string;
  /** Title of the merged header. Defaults to the id: no service's title is the whole. */
  readonly title?: string;
  /** Version of the merged header. Defaults to `federated`, which says what it is. */
  readonly version?: string;
  readonly description?: string;
  /** Servers of the merged document, the gateway's own. Defaults to none, per SPEC 15.1. */
  readonly servers?: readonly IRServer[];
  /** The remotes to fetch and poll. May be empty only when `services` is not. */
  readonly remotes?: readonly OpenRefFederationRemoteOptions[];
  /** Ids of this `forRoot`'s own `documents` entries that join the merge, per SPEC 15.3. */
  readonly services?: readonly OpenRefFederationLocalOptions[];
  /** Resolution policy for a name two services claim. Defaults to `namespace`. */
  readonly onConflict?: FederationConflictMode;
  /** Poll interval while healthy. Defaults to SPEC 15's 60 000. */
  readonly refreshMs?: number;
  /** Ceiling on one fetch, per SPEC 15.2. Defaults to 10 000. */
  readonly timeoutMs?: number;
  /** What the route serves when a remote is not fresh. Defaults to `degrade`. */
  readonly failureMode?: FederationFailureMode;
  /** Where last successful remote versions are kept. Defaults to this process's memory. */
  readonly store?: IFederationCacheDriver;
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
  /**
   * The agent surface every mounted document defaults to, per SPEC 13.2. Built since T058.
   *
   * An entry of `documents` that names its own `agent` overrides this for that mount alone, which
   * is the same relation `theme` has to its per document form.
   */
  readonly agent?: AgentOptions;
  /** The federation of SPEC 15, mounted beside the documents. Built since T046. */
  readonly federation?: OpenRefFederationOptions;
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
 * `theme` left this list at T033, where it was built, and `agent` at T058, per SPEC 18.1.
 * `runner` stays with a corrected owner: the console it once stood for shipped across M2, and the
 * proxy tuning arrived as the `proxy` option, so what this aggregate name still promises is the
 * reconciliation with SPEC 13.2's shape plus the `socket` and `bridge` halves, which are M6.
 */
const NOT_YET_BUILT: Readonly<Record<string, string>> = {
  runner:
    'T034 reconciles this aggregate with SPEC 13.2: the console shipped across M2, proxy ' +
    'tuning is the proxy option, the broker bridge is the bridge option on a mount since T056, ' +
    'and the socket half is the ISocketPort of @openref/vue',
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
    assertBridgeOptions(`the document "${entry.id}"`, entry.bridge);
    // THE ROOT DEFAULT IS PART OF WHAT THIS ENTRY MOUNTS, so the pair the check sees is the one
    // the mount will build from. A `forRoot` that switches MCP on at the root and writes a guard
    // on no entry is exactly the arrangement the refusal exists for, and reading `entry.agent`
    // alone would have let it through on every entry that names none.
    assertAgentOptions(`the document "${entry.id}"`, {
      ...entry,
      agent: entry.agent ?? options.agent,
    });
  }

  // Checked here rather than where it is used, so a malformed template is an error at boot rather
  // than a document that renders with no links and no explanation.
  readSourceLink(options.runtime?.sourceLink);
  assertGuardSecuritySchemes(options.runtime?.guardSecuritySchemes);
  assertFederationOptions(options.federation, ids, routes, options.agent);
}

/**
 * Refuses a federation whose mount cannot work, before any lifecycle exists.
 *
 * WHAT IS CHECKED HERE IS THE WIRING AND NOT THE GRAMMAR: ids, prefixes and urls go through the
 * federation package's own validators when the lifecycle is constructed, because two rules about
 * one grammar is the defect class this repository keeps finding. What only this layer can know
 * is whether the route clashes with a document's and whether a named local service is a
 * `documents` entry of this same `forRoot`: `setup` mounts after `onModuleInit`, so a document
 * mounted that way cannot join a merge that has already been built.
 *
 * @param federation - The federation options, or nothing
 * @param documentIds - Ids of the `documents` entries
 * @param routes - Routes the `documents` entries claim
 * @param rootAgent - The root level agent surface default this mount inherits, if any
 * @throws {InvalidOptionsError} When the federation entry is unusable
 */
function assertFederationOptions(
  federation: OpenRefFederationOptions | undefined,
  documentIds: ReadonlySet<string>,
  routes: ReadonlySet<string>,
  rootAgent: AgentOptions | undefined,
): void {
  if (federation === undefined) return;

  if (typeof federation.route !== 'string' || federation.route === '') {
    throw invalid('the federation needs a route to be mounted on');
  }
  if (routes.has(federation.route)) {
    throw invalid(
      `the federation and a document are both mounted on "${federation.route}", and the second ` +
        'would never be reached',
    );
  }
  if (typeof federation.id !== 'string' || federation.id === '') {
    throw invalid('the federation needs a non empty id for its merged document');
  }

  const remotes = federation.remotes ?? [];
  const locals = federation.services ?? [];
  if (remotes.length === 0 && locals.length === 0) {
    throw invalid(
      'the federation names no remotes and no local services, so there is nothing to merge. ' +
        'Name at least one of the two',
    );
  }

  for (const local of locals) {
    if (!documentIds.has(local.id)) {
      throw invalid(
        `the federation names the local service "${local.id}", and no documents entry carries ` +
          'that id. A local service is a documents entry of this same forRoot, per SPEC 15.3: ' +
          'a document mounted later through setup cannot join a merge that already exists',
      );
    }
  }

  assertVisibility('the federated reference', federation);
  assertBridgeOptions('the federated reference', federation.bridge);
  assertAgentOptions('the federated reference', {
    ...federation,
    agent: federation.agent ?? rootAgent,
  });
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

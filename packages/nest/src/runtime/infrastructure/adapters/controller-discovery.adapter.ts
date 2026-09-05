/**
 * The discovery pass: every route the application declares, with the class and method behind it.
 *
 * This is the half of the runtime story that no specification can supply, and T017 froze the
 * shape it feeds: `CollectorTarget { node, controller, handler }`. Nothing produced one until
 * now, which is why this landed as its own entry rather than inside T018.
 *
 * IT READS METADATA AND NOTHING ELSE, per CLAUDE.md's rule against runtime magic. A handler's
 * path and method are written on it by `@Controller` and `@Get`, under keys the framework has
 * used since NestJS 5 and which `shared/types/nest-surface.ts` declares. Nothing here inspects a
 * function body, and a route whose method is not in the table is reported rather than guessed at.
 *
 * THE GLOBAL PREFIX IS NOT APPLIED HERE, and that is deliberate rather than missing. A prefix is
 * set on the application, `@nestjs/swagger` writes it into the document by default, and the
 * pairing in `runtime/domain/route-pairing.ts` is what reconciles the two. Reading it here would
 * need a sixth value from the framework in order to produce a string the pairing would have to
 * be able to cope without anyway, since a host may equally have generated the document with
 * `ignoreGlobalPrefix`.
 */

import {
  NEST_REQUEST_METHODS,
  NEST_ROUTE_METADATA,
  type ControllerLike,
  type DiscoveryServiceLike,
  type HandlerLike,
  type InstanceWrapperLike,
  type ReflectorLike,
} from '../../../shared/types/nest-surface';

/** One route of the running application. */
export interface DiscoveredRoute {
  readonly controller: ControllerLike;
  /** Class name, which is also the first half of the operation id `@nestjs/swagger` writes. */
  readonly controllerName: string;
  readonly handler: HandlerLike;
  /** Method name, which is the second half of that operation id. */
  readonly handlerName: string;
  /**
   * The class the handler is written on, which is the controller unless it was inherited.
   *
   * TWO NAMES BECAUSE THEY ANSWER TWO QUESTIONS. Pairing needs the registered controller, since
   * that is what `@nestjs/swagger` puts in the operation id and what the route is served by. A
   * source link needs the class the method's body is in, which is the base class when a handler
   * is inherited, because that is the file it can be found in.
   */
  readonly declaredOn: ControllerLike;
  /** Lowercase HTTP method, as a document writes it. */
  readonly method: string;
  /** Path in the document's dialect: leading slash, `{name}` parameters, no trailing slash. */
  readonly path: string;
}

/**
 * Something the pass saw and could not turn into a route.
 *
 * IT IS A LIST AND NOT A LOG. A skipped handler is the difference between "this endpoint has no
 * runtime facts" and "this endpoint was never looked at", and only one of those is a bug in the
 * application. `doctor` reads this from T022 onwards.
 */
export interface DiscoveryProblem {
  /** What was skipped, named the way a reader of `doctor` would recognise it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /**
   * The action, or that there is none and why the record exists anyway, per SPEC 7.1.
   *
   * OPTIONAL, AND ABSENT MEANS THE REASON IS USED FOR BOTH, which is where every producer of this
   * shape stood before the split. The collectors of SPEC 6.2 set it; the event side producers of
   * SPEC 8.3 have not been moved yet and are named as the remainder rather than changed quietly.
   */
  readonly action?: string;
  /** The reasoning behind it, for a reader who opens it, per SPEC 7.1. */
  readonly detail?: string;
}

/** What one pass produced. */
export interface DiscoveryResult {
  readonly routes: readonly DiscoveredRoute[];
  readonly problems: readonly DiscoveryProblem[];
}

/**
 * Enumerates every route the application declares.
 *
 * @param discovery - Nest's `DiscoveryService`
 * @param reflector - Nest's `Reflector`, which is how the metadata keys are read
 * @returns The routes, and everything that was skipped with the reason
 */
export function discoverRoutes(
  discovery: DiscoveryServiceLike,
  reflector: ReflectorLike,
): DiscoveryResult {
  const routes: DiscoveredRoute[] = [];
  const problems: DiscoveryProblem[] = [];

  for (const wrapper of discovery.getControllers()) {
    const controller = controllerOf(wrapper);
    if (controller === undefined) {
      // A controller registered with `useValue` has no class, so there is nothing to read
      // metadata off and nothing for a collector to be given.
      problems.push({
        subject: String(wrapper.name ?? 'an unnamed controller'),
        reason: 'it has no class behind it, so no route metadata could be read',
      });
      continue;
    }

    collectController(controller, wrapper.instance, reflector, routes, problems);
  }

  return { routes, problems };
}

/**
 * Reads the class out of a wrapper, when there is one.
 *
 * @param wrapper - As `DiscoveryService` reported it
 * @returns The controller class, or undefined
 */
function controllerOf(wrapper: InstanceWrapperLike): ControllerLike | undefined {
  return typeof wrapper.metatype === 'function' ? (wrapper.metatype as ControllerLike) : undefined;
}

/**
 * Adds every route one controller declares.
 *
 * @param controller - The controller class
 * @param instance - Its instance, whose prototype carries the handlers
 * @param reflector - Nest's `Reflector`
 * @param routes - Accumulator for the routes found
 * @param problems - Accumulator for what was skipped
 */
function collectController(
  controller: ControllerLike,
  instance: unknown,
  reflector: ReflectorLike,
  routes: DiscoveredRoute[],
  problems: DiscoveryProblem[],
): void {
  const start: unknown =
    typeof instance === 'object' && instance !== null
      ? Object.getPrototypeOf(instance)
      : controller.prototype;
  if (typeof start !== 'object' || start === null) return;

  const controllerName = controller.name;
  const prefixes = pathsOf(reflector.get(NEST_ROUTE_METADATA.path, controller));

  for (const { name: handlerName, handler, owner } of handlersOf(start, controller)) {
    const methodMetadata = reflector.get(NEST_ROUTE_METADATA.method, handler);
    // Every method of a controller that is not a route: a helper, a lifecycle hook, an
    // interceptor's target. Nest writes no method on those, and they are not a problem.
    if (typeof methodMetadata !== 'number') continue;

    const method = NEST_REQUEST_METHODS[methodMetadata];
    if (method === undefined) {
      problems.push({
        subject: `${controllerName}.${handlerName}`,
        reason:
          `it is registered for request method ${String(methodMetadata)}, which is either ` +
          'the ALL wildcard or a WebDAV verb, and neither names one operation',
      });
      continue;
    }

    for (const prefix of prefixes) {
      for (const suffix of pathsOf(reflector.get(NEST_ROUTE_METADATA.path, handler))) {
        routes.push({
          controller,
          controllerName,
          declaredOn: owner,
          handler,
          handlerName,
          method,
          path: joinPath(prefix, suffix),
        });
      }
    }
  }
}

/** One method found on a controller, and the class it is written on. */
interface FoundHandler {
  readonly name: string;
  readonly handler: HandlerLike;
  readonly owner: ControllerLike;
}

/**
 * Every method of a controller, including the ones it inherits.
 *
 * THE CHAIN IS WALKED BECAUSE NESTJS WALKS IT. A controller extending a base class that carries
 * `@Get()` serves that route, and a pass that read only the subclass's own properties would
 * report every such endpoint as documented but unreachable, which is a drift finding this
 * package would have invented. An override shadows the inherited method, exactly as it does at
 * runtime, because the first prototype in the chain wins.
 *
 * @param start - The instance's prototype, which is the subclass's
 * @param controller - The registered controller class, used when a prototype has no constructor
 * @returns Each method once, nearest declaration first
 */
function handlersOf(start: object, controller: ControllerLike): readonly FoundHandler[] {
  const found: FoundHandler[] = [];
  const seen = new Set<string>();

  let prototype: object | null = start;
  while (prototype !== null && prototype !== Object.prototype) {
    const owner: unknown = (prototype as { constructor?: unknown }).constructor;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor' || seen.has(name)) continue;
      seen.add(name);

      const handler: unknown = Object.getOwnPropertyDescriptor(prototype, name)?.value;
      if (typeof handler !== 'function') continue;

      found.push({
        name,
        handler: handler as HandlerLike,
        owner: typeof owner === 'function' ? (owner as ControllerLike) : controller,
      });
    }

    prototype = Object.getPrototypeOf(prototype) as object | null;
  }

  return found;
}

/**
 * Reads a `path` metadata value, which NestJS allows to be a string or a list of them.
 *
 * @param metadata - Whatever was under the key
 * @returns At least one path fragment, since an absent one means the empty fragment
 */
function pathsOf(metadata: unknown): readonly string[] {
  if (typeof metadata === 'string') return [metadata];
  if (Array.isArray(metadata)) {
    const strings = metadata.filter((entry): entry is string => typeof entry === 'string');
    return strings.length > 0 ? strings : [''];
  }
  return [''];
}

/**
 * Joins a controller prefix and a handler path into the dialect a document is written in.
 *
 * `:id` becomes `{id}` because that is the only difference between the two spellings that
 * matters to the pairing, and an optional `:id?` loses its marker for the same reason: the
 * document writes two paths where NestJS writes one, and the shorter of the two is what the
 * suffix rule then matches.
 *
 * @param prefix - Controller level fragment
 * @param suffix - Handler level fragment
 * @returns A path with a leading slash, no trailing slash, and `{name}` parameters
 */
export function joinPath(prefix: string, suffix: string): string {
  const segments = [...prefix.split('/'), ...suffix.split('/')]
    .filter((segment) => segment !== '')
    .map(parameterSegment);

  return `/${segments.join('/')}`;
}

/**
 * Rewrites one path segment from the NestJS dialect into the document's.
 *
 * @param segment - One segment, without slashes
 * @returns The segment, with `:name` written as `{name}`
 */
function parameterSegment(segment: string): string {
  if (!segment.startsWith(':')) return segment;

  const name = segment.slice(1).replace(/[?*]+$/, '');
  return name === '' ? segment : `{${name}}`;
}

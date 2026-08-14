/**
 * Reading the pipes standing on a route, at all three scopes of SPEC 6.2.1.
 *
 * ONLY CLASS NAMES, NEVER LOGIC, the guard rule applied to the other enhancer: what a pipe will
 * do to a value depends on the value, so it is not a property of the route, and the class name
 * is. Nothing here derives a 400 from a pipe's presence; SPEC 6.4's two derivation rules do not
 * grow.
 *
 * THE SCOPE TRAVELS WITH EVERY NAME, per the APP_GUARD rule: `@UsePipes` on the class or the
 * handler is the route's own declaration and both apply, so both fold into `route`; a provider
 * under `APP_PIPE` is a decision about the application; a pipe inside a parameter decorator is a
 * decision about one value. A reader deciding whether input is validated needs to know which
 * decision they are looking at.
 */

import {
  isEnhancerToken,
  NEST_ENHANCER_TOKENS,
  NEST_PIPE_ENHANCER_SUBTYPE,
  NEST_PIPES_METADATA,
  NEST_ROUTE_ARGS_METADATA,
  type DiscoveryServiceLike,
  type InstanceWrapperLike,
  type MetadataReflect,
  type ReflectorLike,
} from '../../shared/types/nest-surface';

/** What was found at one scope, and what could not be named. */
export interface PipeReading {
  /** Class names in application order, without duplicates. */
  readonly names: readonly string[];
  /** How many pipes were present and could not be named. Counted, so nothing is dropped silently. */
  readonly anonymous: number;
}

/**
 * Reads the pipes declared with `@UsePipes` on a controller and on its handler.
 *
 * BOTH LEVELS ARE READ AND NEITHER OVERRIDES THE OTHER, the `readGuards` rule: NestJS runs the
 * class's pipes and then the handler's, so a route with one of each is transformed by both.
 *
 * @param reflector - Nest's reflector, narrowed
 * @param controller - The controller class the route was registered as
 * @param handler - The route handler
 * @returns The class names in execution order, and the count of unnameable ones
 */
export function readRoutePipes(
  reflector: ReflectorLike,
  controller: unknown,
  handler: unknown,
): PipeReading {
  const names: string[] = [];
  const seen = new Set<string>();
  let anonymous = 0;

  for (const target of [controller, handler]) {
    for (const entry of asArray(reflector.get(NEST_PIPES_METADATA, target))) {
      const name = pipeName(entry);

      if (name === undefined) {
        anonymous += 1;
        continue;
      }

      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }

  return { names, anonymous };
}

/**
 * Reads the pipes inside a handler's own parameter decorators.
 *
 * THE BINDINGS ARE TWO-TARGET METADATA, on the controller class and the method name together,
 * which is why this takes `MetadataReflect` rather than the reflector: `ReflectorLike` has no
 * property key. Each binding's `pipes` array holds classes and instances exactly as
 * `@Query('sort', new ParseIntPipe())` wrote them.
 *
 * @param reflect - The metadata API, from `metadataReflect()`
 * @param controller - The controller class the route was registered as
 * @param handlerName - The method name, as the prototype holds it
 * @returns The class names in binding order, and the count of unnameable ones
 */
export function readParameterPipes(
  reflect: MetadataReflect,
  controller: object,
  handlerName: string,
): PipeReading {
  const names: string[] = [];
  const seen = new Set<string>();
  let anonymous = 0;

  const bindings = reflect.getMetadata(NEST_ROUTE_ARGS_METADATA, controller, handlerName);
  if (typeof bindings !== 'object' || bindings === null) return { names, anonymous };

  for (const entry of Object.values(bindings)) {
    if (typeof entry !== 'object' || entry === null) continue;

    const pipes = (entry as { pipes?: unknown }).pipes;
    for (const pipe of asArray(pipes)) {
      const name = pipeName(pipe);

      if (name === undefined) {
        anonymous += 1;
        continue;
      }

      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }

  return { names, anonymous };
}

/**
 * Reads the pipes registered for the whole application, the `readGlobalGuards` walk for the
 * other enhancer token.
 *
 * READ ONCE FOR THE APPLICATION AND NOT ONCE PER ROUTE, and `app.useGlobalPipes` stays unread
 * for the reason `app.useGlobalGuards` does: a list still mutable when `setup` runs is not a
 * fact about the application. A provider under `APP_PIPE` declared `REQUEST` or `TRANSIENT`
 * scoped goes into `injectables` and is not seen, exactly as with guards.
 *
 * @param discovery - Nest's `DiscoveryService`
 * @returns The class names in registration order, and the count of unnameable ones
 */
export function readGlobalPipes(discovery: DiscoveryServiceLike): PipeReading {
  const names: string[] = [];
  const seen = new Set<string>();
  let anonymous = 0;

  for (const wrapper of discovery.getProviders()) {
    if (!isGlobalPipe(wrapper)) continue;

    // The instance names the pipe and `metatype` is the fallback, in that order, for the reason
    // `readGlobalGuards` records: under `useFactory` the metatype is the factory.
    const name = pipeName(wrapper.instance) ?? pipeName(wrapper.metatype);

    if (name === undefined) {
      anonymous += 1;
      continue;
    }

    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  return { names, anonymous };
}

/**
 * Reports whether one provider was registered as an application wide pipe.
 *
 * @param wrapper - One provider as `DiscoveryService` reported it
 * @returns True when it is a pipe registered under `APP_PIPE`
 */
function isGlobalPipe(wrapper: InstanceWrapperLike): boolean {
  return (
    wrapper.subtype === NEST_PIPE_ENHANCER_SUBTYPE ||
    isEnhancerToken(wrapper.token, NEST_ENHANCER_TOKENS.pipe)
  );
}

/**
 * Narrows whatever was under a metadata key to a list.
 *
 * @param value - Whatever was there
 * @returns The entries, or an empty list
 */
function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Names one pipe, whether it was written as a class or as an instance.
 *
 * A PLAIN OBJECT IS UNNAMEABLE AND IS NOT CALLED `Object`, the `guardName` rule:
 * `{ transform: (v) => v }` is a legal pipe and its constructor's name would be a row saying
 * `Object`. Refused by identity rather than by name, so a class a host called `Object` is read.
 *
 * @param entry - One entry from metadata, or a provider's class or instance
 * @returns The class name, or undefined when it has none to give
 */
function pipeName(entry: unknown): string | undefined {
  if (typeof entry === 'function') return entry.name === '' ? undefined : entry.name;

  if (typeof entry === 'object' && entry !== null) {
    const constructor: unknown = (entry as { constructor?: unknown }).constructor;

    if (constructor === Object) return undefined;
    if (typeof constructor === 'function' && constructor.name !== '') return constructor.name;
  }

  return undefined;
}

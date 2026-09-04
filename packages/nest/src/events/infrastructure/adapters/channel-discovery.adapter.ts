import { OPENREF_METADATA } from '../../../api/decorators/metadata';
import type { ApiChannelOptions, ApiMessageOptions } from '../../../api/decorators/api-decorators';
import type { DiscoveryProblem } from '../../../runtime/infrastructure/adapters/controller-discovery.adapter';
import {
  metadataReflect,
  type ControllerLike,
  type DiscoveryServiceLike,
  type HandlerLike,
  type InstanceWrapperLike,
} from '../../../shared/types/nest-surface';
import {
  declaredValue,
  derived,
  gatewayAddress,
  readGateway,
  readMicroserviceHandler,
  readSubscribeMessage,
  GATEWAY_PROTOCOL,
  type DeclaredValue,
  type DerivedValue,
  type EventValue,
  type TransportReading,
} from '../../domain/event-metadata';

/**
 * Every channel the running application serves, per SPEC 8.3.
 *
 * IT IS THE SAME JOB `controller-discovery.adapter.ts` DOES FOR ROUTES AND IT IS A SECOND WALK, on
 * purpose. A route is a method and a path on a controller; a channel is a pattern on a controller
 * or an event on a gateway, and gateways are providers rather than controllers, so the two walks
 * read different containers as well as different keys. Folding them into one function would make
 * every reader of either hold both vocabularies in mind.
 *
 * NOTHING IS INFERRED FROM A HANDLER BODY, per CLAUDE.md's rule against runtime magic and per SPEC
 * 8.3. Every value here is under a metadata key this package names, and a handler that carries
 * none of them is not an event handler as far as this walk is concerned.
 *
 * WHAT CANNOT BE READ IS REPORTED RATHER THAN GUESSED. A pattern of a shape no address can be made
 * from, a transport number outside the table, a gateway with no `@SubscribeMessage`: each is a
 * {@link DiscoveryProblem} naming the class and the method, which is what `doctor` prints, and none
 * of them produces a channel with an invented address or an invented protocol.
 */

/**
 * Which decorator a discovered channel came from, which is what SPEC 8.3's table is keyed by.
 *
 * `api-channel` IS THE THIRD CLASS KIND AND NOT A FOURTH DECORATOR. It is what a declaration on a
 * plain `@Injectable()` provider is read as, because a provider is neither of the two class kinds
 * the framework sources live on, and recording it under one of their names would say the framework
 * routed something it did not.
 */
export type DiscoveredChannelSource =
  'message-pattern' | 'event-pattern' | 'subscribe-message' | 'api-channel';

/** One channel of the running application, before anything has been merged or normalized. */
export interface DiscoveredChannel {
  /** The address, which is the pattern for a microservice and the socket path for a gateway. */
  readonly address: EventValue<string>;
  /** Which decorator produced it. */
  readonly source: DiscoveredChannelSource;
  /**
   * The transport the handler names, when it names one.
   *
   * `DerivedValue` AND NOT `EventValue`, SINCE THE SECOND REVIEW OF `T051`. It was the union, and
   * no producer could fill the declared arm: the only one is `readMicroserviceHandler`, whose own
   * return type is `DerivedValue`, and `@ApiChannel` declares a `protocol` rather than a transport,
   * which reaches the synthesis by its own route. The union therefore obliged every reader to
   * handle a case nothing could produce, and one reader did, in a branch no test could reach.
   */
  readonly transport?: DerivedValue<TransportReading>;
  /** The protocol, when it follows from the source rather than from a transport. */
  readonly protocol?: EventValue<string>;
  /** What `@ApiChannel` declared, whole, so the synthesis can apply every member it names. */
  readonly declared?: DeclaredValue<ApiChannelOptions>;
  /** What `@ApiMessage` declared, whole. */
  readonly message?: DeclaredValue<ApiMessageOptions>;
  readonly controller: ControllerLike;
  readonly controllerName: string;
  readonly declaredOn: ControllerLike;
  readonly handler: HandlerLike;
  readonly handlerName: string;
}

/** What one channel discovery pass produced. */
export interface ChannelDiscoveryResult {
  readonly channels: readonly DiscoveredChannel[];
  readonly problems: readonly DiscoveryProblem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the class out of a wrapper, when there is one.
 *
 * @param wrapper - As `DiscoveryService` reported it
 * @returns The class, or undefined for a provider registered with `useValue`
 */
function classOf(wrapper: InstanceWrapperLike): ControllerLike | undefined {
  return typeof wrapper.metatype === 'function' ? (wrapper.metatype as ControllerLike) : undefined;
}

/** One method found on a class, and the class it is written on. */
interface FoundHandler {
  readonly name: string;
  readonly handler: HandlerLike;
  readonly owner: ControllerLike;
}

/**
 * Every method of a class, including the ones it inherits.
 *
 * THE CHAIN IS WALKED FOR THE REASON THE ROUTE WALK WALKS IT: a controller extending a base class
 * that carries `@EventPattern` serves that channel, and reading only the subclass's own properties
 * would leave it out of the reference while the application answers it.
 *
 * @param start - The instance's prototype when there is an instance, else the class's
 * @param owner - The registered class, used when a prototype has no constructor
 * @returns Each method once, nearest declaration first
 */
function handlersOf(start: object, owner: ControllerLike): readonly FoundHandler[] {
  const found: FoundHandler[] = [];
  const seen = new Set<string>();

  let prototype: object | null = start;
  while (prototype !== null && prototype !== Object.prototype) {
    const constructor: unknown = (prototype as { constructor?: unknown }).constructor;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor' || seen.has(name)) continue;
      seen.add(name);

      const handler: unknown = Object.getOwnPropertyDescriptor(prototype, name)?.value;
      if (typeof handler !== 'function') continue;

      found.push({
        name,
        handler: handler as HandlerLike,
        owner: typeof constructor === 'function' ? (constructor as ControllerLike) : owner,
      });
    }

    prototype = Object.getPrototypeOf(prototype) as object | null;
  }

  return found;
}

/** The prototype whose methods are the handlers, given a wrapper's instance and its class. */
function prototypeOf(instance: unknown, target: ControllerLike): object | undefined {
  const start: unknown =
    typeof instance === 'object' && instance !== null
      ? Object.getPrototypeOf(instance)
      : target.prototype;

  return typeof start === 'object' && start !== null ? start : undefined;
}

/** What `@ApiChannel` wrote on a handler, when a person wrote one. */
function declaredChannel(handler: object): DeclaredValue<ApiChannelOptions> | undefined {
  const written: unknown = metadataReflect().getMetadata(OPENREF_METADATA.channel, handler);
  return isRecord(written) ? declaredValue(written as ApiChannelOptions) : undefined;
}

/** What `@ApiMessage` wrote on a handler, when a person wrote one. */
function declaredMessage(handler: object): DeclaredValue<ApiMessageOptions> | undefined {
  const written: unknown = metadataReflect().getMetadata(OPENREF_METADATA.message, handler);
  return isRecord(written) ? declaredValue(written as ApiMessageOptions) : undefined;
}

/**
 * Adds every channel one microservice controller declares.
 *
 * @param target - The controller class
 * @param instance - Its instance, whose prototype carries the handlers
 * @param channels - Accumulator
 * @param problems - Accumulator for what could not be read
 */
function collectPatterns(
  target: ControllerLike,
  instance: unknown,
  channels: DiscoveredChannel[],
  problems: DiscoveryProblem[],
): void {
  const start = prototypeOf(instance, target);
  if (start === undefined) return;

  for (const { name: handlerName, handler, owner } of handlersOf(start, target)) {
    const reading = readMicroserviceHandler(handler);
    const declared = declaredChannel(handler);

    // A handler with no framework pattern and an `@ApiChannel` naming an address is a channel a
    // person declared outright, which SPEC 8.3 admits: the decorator is the `declared` level and
    // does not need something to override.
    if (reading === undefined) {
      const address = declared?.value.address;
      if (declared === undefined || address === undefined || address === '') continue;

      channels.push({
        address: declaredValue(address),
        source: 'api-channel',
        declared,
        ...messageOf(handler),
        controller: target,
        controllerName: target.name,
        declaredOn: owner,
        handler,
        handlerName,
      });
      continue;
    }

    if (reading.unreadablePatterns > 0) {
      problems.push({
        subject: `${target.name}.${handlerName}`,
        reason:
          `${String(reading.unreadablePatterns)} of its patterns are neither a string, a number ` +
          'nor an object, so no channel address could be made from them and they are absent ' +
          'from the reference rather than rendered as the text of whatever they are',
      });
    }

    if (reading.unknownTransport !== undefined) {
      problems.push({
        subject: `${target.name}.${handlerName}`,
        reason:
          `it names transport ${String(reading.unknownTransport)}, which is outside the Transport ` +
          'enum this package reads, so its channel is bound to no server and carries no ' +
          'protocol. A custom transport strategy produces this',
      });
    }

    for (const pattern of reading.patterns) {
      const base: DiscoveredChannel = {
        address: declaredAddress(declared) ?? derived(pattern.address),
        source: reading.kind === 'event' ? 'event-pattern' : 'message-pattern',
        ...(reading.transport === undefined ? {} : { transport: reading.transport }),
        ...(declared === undefined ? {} : { declared }),
        ...messageOf(handler),
        controller: target,
        controllerName: target.name,
        declaredOn: owner,
        handler,
        handlerName,
      };

      channels.push(base);
    }
  }
}

/** The address `@ApiChannel` declared, when it declared one. */
function declaredAddress(
  declared: DeclaredValue<ApiChannelOptions> | undefined,
): DeclaredValue<string> | undefined {
  const address = declared?.value.address;
  return address === undefined || address === '' ? undefined : declaredValue(address);
}

/** The `@ApiMessage` half, as the spread a channel literal takes. */
function messageOf(handler: object): { message?: DeclaredValue<ApiMessageOptions> } {
  const message = declaredMessage(handler);
  return message === undefined ? {} : { message };
}

/**
 * Adds every channel one WebSocket gateway declares.
 *
 * ONE CHANNEL PER GATEWAY AND ONE OPERATION PER `@SubscribeMessage`, which is the reading SPEC 8.3
 * records. A socket.io gateway is one address that many events travel over, so a channel per event
 * would put the same address in the reference once per event and give a reader no way to see that
 * they share a connection.
 *
 * @param target - The gateway class
 * @param instance - Its instance
 * @param channels - Accumulator
 * @param problems - Accumulator for what could not be read
 * @returns True when the class is a gateway, whether or not it produced a channel
 */
function collectGateway(
  target: ControllerLike,
  instance: unknown,
  channels: DiscoveredChannel[],
  problems: DiscoveryProblem[],
): boolean {
  const gateway = readGateway(target);
  if (gateway === undefined) return false;

  const start = prototypeOf(instance, target);
  if (start === undefined) return true;

  const address = gatewayAddress(gateway);
  let events = 0;

  for (const { name: handlerName, handler, owner } of handlersOf(start, target)) {
    const event = readSubscribeMessage(handler);
    if (event === undefined) continue;
    events += 1;

    const declared = declaredChannel(handler);
    channels.push({
      address: declaredAddress(declared) ?? derived(address),
      source: 'subscribe-message',
      protocol: derived(GATEWAY_PROTOCOL),
      ...(declared === undefined ? {} : { declared }),
      ...messageOf(handler),
      controller: target,
      controllerName: target.name,
      declaredOn: owner,
      handler,
      handlerName,
    });
  }

  if (events === 0) {
    problems.push({
      subject: target.name,
      reason:
        'it is a WebSocket gateway with no @SubscribeMessage handler, so it declares no event ' +
        'and no channel was produced for it. A gateway that only pushes is this state, and ' +
        '@ApiChannel is how such a channel is declared',
    });
  }

  return true;
}

/**
 * Adds every channel one plain provider declares outright.
 *
 * THE THIRD CLASS KIND OF SPEC 8.3, ADMITTED 2026-09-04 AND NOT BEFORE. A projector, a saga or a
 * listener a broker library registers is a plain `@Injectable()`: it is not a `@Controller`, so
 * `collectPatterns` never saw it, and it carries no `@WebSocketGateway`, so `collectGateway`
 * returned on it. `@ApiChannel` written on such a class therefore reached nothing at all, while
 * five prose surfaces of this repository and its own shipped example presented that form as the
 * ordinary one. It is admitted rather than the surfaces being narrowed, per SPEC 8.3.
 *
 * A DECLARATION AND NOTHING ELSE, WHICH IS THE NARROWING AND NOT A HALF MEASURE. A provider
 * carrying `@MessagePattern` or `@EventPattern` produces nothing here, because Nest routes those
 * off a controller: a channel built from a pattern on a class the framework does not route would
 * be an address in the reference no message ever arrives at. `@ApiChannel` is a person stating a
 * fact, and that statement is as true on a provider as it is anywhere else.
 *
 * NO PROBLEM IS REPORTED FOR A PROVIDER THAT DECLARES NOTHING, which is the rule
 * {@link discoverChannels} already states: an application's providers are mostly not channels, and
 * a finding per provider would bury every real one.
 *
 * @param target - The provider class
 * @param instance - Its instance, whose prototype carries the handlers
 * @param channels - Accumulator
 */
function collectDeclarations(
  target: ControllerLike,
  instance: unknown,
  channels: DiscoveredChannel[],
): void {
  const start = prototypeOf(instance, target);
  if (start === undefined) return;

  for (const { name: handlerName, handler, owner } of handlersOf(start, target)) {
    const declared = declaredChannel(handler);
    const address = declared?.value.address;
    if (declared === undefined || address === undefined || address === '') continue;

    channels.push({
      address: declaredValue(address),
      source: 'api-channel',
      declared,
      ...messageOf(handler),
      controller: target,
      controllerName: target.name,
      declaredOn: owner,
      handler,
      handlerName,
    });
  }
}

/**
 * Enumerates every channel the application declares.
 *
 * CONTROLLERS AND PROVIDERS BOTH, because the three sources live in two containers.
 * `@MessagePattern` goes on a controller and `@WebSocketGateway` implies `@Injectable`, so a
 * gateway is a provider and `getControllers` never sees it. A provider that is neither is read for
 * a declaration and nothing else, per SPEC 8.3 as amended 2026-09-04, and one that declares
 * nothing is skipped in silence, since an application's providers are mostly not channels and
 * reporting each would bury the real findings.
 *
 * THE PROVIDER WALK IS DEEPER THAN IT WAS AND THE COST IS NAMED. Until 2026-09-04 a provider that
 * failed the `@WebSocketGateway` read cost one metadata lookup; it now costs a walk of its
 * prototype chain and one lookup per method. It runs once, inside the same `onModuleInit` that
 * already walks every controller the same way, and the alternative was a decorator that five
 * documented surfaces promise and nothing reads.
 *
 * @param discovery - Nest's `DiscoveryService`
 * @returns The channels, and everything that could not be read with the reason
 */
export function discoverChannels(discovery: DiscoveryServiceLike): ChannelDiscoveryResult {
  const channels: DiscoveredChannel[] = [];
  const problems: DiscoveryProblem[] = [];

  for (const wrapper of discovery.getControllers()) {
    const target = classOf(wrapper);
    if (target === undefined) continue;
    collectPatterns(target, wrapper.instance, channels, problems);
  }

  for (const wrapper of discovery.getProviders()) {
    const target = classOf(wrapper);
    if (target === undefined) continue;

    // A GATEWAY IS READ AS A GATEWAY AND NEVER ALSO AS A PLAIN PROVIDER. `collectGateway` already
    // takes the declaration on each `@SubscribeMessage` handler, so running both walks over one
    // class would file a channel twice for a gateway method carrying `@ApiChannel`.
    if (collectGateway(target, wrapper.instance, channels, problems)) continue;

    collectDeclarations(target, wrapper.instance, channels);
  }

  return { channels, problems };
}

import { canonicalize } from '@openref/core';
import {
  NEST_MICROSERVICE_METADATA,
  NEST_PATTERN_HANDLERS,
  NEST_TRANSPORT_NAMES,
  NEST_TRANSPORT_PROTOCOLS,
  NEST_WEBSOCKET_METADATA,
  NEST_WEBSOCKET_PROTOCOL,
  metadataReflect,
} from '../../shared/types/nest-surface';

/**
 * Reading the event surface of NestJS, per SPEC 8.3, with the confidence of every value in its type.
 *
 * THE SEPARATION IS IN THE TYPES AND NOT IN A COMMENT. `T019` set the rule that `declared` belongs
 * to an explicit decorator of this package and to nothing else, and SPEC 8.3 repeats it for the
 * transport in particular: a transport read from the microservice configuration is `derived`,
 * never `declared`. Every reader in this file returns {@link DerivedValue}, whose `confidence` is
 * the literal `'derived'`, so a reader here cannot produce a declared value however it is called.
 * The declared half comes from `@ApiChannel` and `@ApiMessage` and is built by their own reader,
 * which is the only producer of {@link DeclaredValue} in this package.
 *
 * NOTHING HERE IMPORTS `@nestjs/microservices` OR `@nestjs/websockets`. The keys are literals in
 * `shared/types/nest-surface.ts`, measured against the real decorators by
 * `test/unit/nest-value-surface.spec.ts`, for the reason that file gives: an application without
 * microservices carries none of these keys, and making two packages a dependency of every consumer
 * to read five strings is a cost paid by the hosts that do not use the feature.
 */

/** A value read from framework metadata under a key this package knows. Never `declared`. */
export interface DerivedValue<Value> {
  readonly value: Value;
  readonly confidence: 'derived';
}

/** A value a person wrote with `@ApiChannel` or `@ApiMessage`. */
export interface DeclaredValue<Value> {
  readonly value: Value;
  readonly confidence: 'declared';
}

/** Either, for a member that both halves can fill. */
export type EventValue<Value> = DeclaredValue<Value> | DerivedValue<Value>;

/**
 * Wraps a value read from framework metadata.
 *
 * @param value - What the key held
 * @returns The value at `derived`, which is the only confidence this file can produce
 */
export function derived<Value>(value: Value): DerivedValue<Value> {
  return { value, confidence: 'derived' };
}

/**
 * Wraps a value a person wrote with one of this package's own decorators.
 *
 * @param value - What the decorator was given
 * @returns The value at `declared`
 */
export function declaredValue<Value>(value: Value): DeclaredValue<Value> {
  return { value, confidence: 'declared' };
}

/**
 * The value SPEC 6.1's seniority picks, out of everything that named one member.
 *
 * THE LEVEL DECIDES, AND THAT IS THE POINT OF THIS FUNCTION EXISTING AT ALL. SPEC 8.3 says that
 * where both halves name one member the declared one wins, by SPEC 6.1's seniority. Written as a
 * chain of `??` over three fields, that sentence is true only for as long as whoever edits the
 * chain keeps the fields in the right order, and the `confidence` every reader here carefully
 * produces is never read by anybody. Written this way, the level is what decides and the order of
 * the arguments is not, so the sentence is about the values rather than about this file's layout.
 * Found by the review of `T051`, which measured that nothing anywhere read a level.
 *
 * @param candidates - Everything that named the member, in the order they were looked for
 * @returns The declared one if there is one, else the first derived one, else nothing
 */
export function bySeniority<Value>(
  candidates: readonly (EventValue<Value> | undefined)[],
): EventValue<Value> | undefined {
  const named = candidates.filter((value): value is EventValue<Value> => value !== undefined);
  return named.find((value) => value.confidence === 'declared') ?? named[0];
}

/** Which decorator a microservice handler carries. */
export type PatternHandlerKind = 'message' | 'event';

/** One microservice pattern a handler answers, with the shape the document has to render. */
export interface PatternReading {
  /** The pattern rendered as an address. See {@link patternAddress}. */
  readonly address: string;
  /** Whether the pattern was written as an object rather than as a string or a number. */
  readonly structured: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Renders one pattern as a channel address, per SPEC 8.3.
 *
 * A STRUCTURED PATTERN IS HANDLED AND NOT STRINGIFIED. `@MessagePattern({ cmd: 'sum' })` is the
 * ordinary shape for a TCP or Redis microservice, and `String(pattern)` on it yields
 * `[object Object]`, which is one address for every such handler in the application. The rendering
 * is this project's own canonical serialization: keys sorted by code point, numbers normalized,
 * which is deterministic by construction and is the same function the document hash goes through.
 * `test/unit/event-discovery.spec.ts` compares it with the framework's own `transformPatternToRoute`
 * over a matrix of patterns, so the address a reader matches against is the route NestJS routes by
 * rather than a spelling this package invented. The file is named because a comment naming the
 * wrong one sends a reader looking for a case that is not there: this one said
 * `nest-value-surface.spec.ts` until the review of `T051` went and looked.
 *
 * @param pattern - The pattern exactly as the decorator was given it
 * @returns The address, or nothing when the pattern is of a shape no address can be made from
 */
export function patternAddress(pattern: unknown): PatternReading | undefined {
  if (typeof pattern === 'string')
    return pattern === '' ? undefined : { address: pattern, structured: false };
  if (typeof pattern === 'number' && Number.isFinite(pattern)) {
    return { address: String(pattern), structured: false };
  }
  if (!isRecord(pattern)) return undefined;

  return { address: canonicalize(pattern), structured: true };
}

/** What one microservice handler declares, read from the three keys of SPEC 8.3. */
export interface MicroserviceReading {
  readonly kind: PatternHandlerKind;
  /** One entry per pattern the decorator was given; it accepts several. */
  readonly patterns: readonly PatternReading[];
  /** Patterns the reader could make no address from, kept so `doctor` can name them. */
  readonly unreadablePatterns: number;
  /** The transport the decorator named, when it named one. Derived by construction. */
  readonly transport?: DerivedValue<TransportReading>;
  /** The transport number the decorator named, when this package has no name for it. */
  readonly unknownTransport?: number;
}

/** A transport, by the name its enum gives it and the protocol it speaks. */
export interface TransportReading {
  /** `KAFKA`, `RMQ`, and the rest of the enum's own spelling. */
  readonly name: string;
  /** The protocol an AsyncAPI server declares for it, such as `kafka` or `amqp`. */
  readonly protocol: string;
}

/**
 * Reads what `@MessagePattern` or `@EventPattern` wrote on one handler.
 *
 * THE PATTERN KEY HOLDS A LIST AND NOT A PATTERN, which is measured rather than assumed:
 * `@MessagePattern('orders.get')` leaves `['orders.get']`, because the decorator accepts several
 * patterns for one handler. Reading it as a single value would have produced one channel whose
 * address is the string form of an array.
 *
 * @param handler - The route handler, which is where the framework writes these keys
 * @returns What the handler declares, or nothing when it carries no pattern at all
 */
export function readMicroserviceHandler(handler: object): MicroserviceReading | undefined {
  const reflect = metadataReflect();
  const raw: unknown = reflect.getMetadata(NEST_MICROSERVICE_METADATA.pattern, handler);
  if (raw === undefined) return undefined;

  const written: readonly unknown[] = Array.isArray(raw) ? (raw as readonly unknown[]) : [raw];
  const patterns: PatternReading[] = [];
  let unreadablePatterns = 0;
  for (const pattern of written) {
    const read = patternAddress(pattern);
    if (read === undefined) unreadablePatterns += 1;
    else patterns.push(read);
  }

  const handlerType: unknown = reflect.getMetadata(NEST_MICROSERVICE_METADATA.handlerType, handler);
  // `event` WHEN THE KEY SAYS SO AND `message` OTHERWISE, WHICH IS WHAT THIS LINE DOES AND WHAT
  // THE COMMENT USED TO DENY. It said `message` was the reading only when the key said so, and the
  // expression below has always read a missing key as `message`. Measured on the installed NestJS
  // 11 rather than argued: the real `@MessagePattern` always writes 1 and the real `@EventPattern`
  // always writes 2, both alongside the pattern key that got this function called at all, so a
  // handler reaching the fallback carries a pattern this package read and a handler type the
  // framework does not omit. `message` is the fallback because the two differ in this package only
  // in `DiscoveredChannelSource`, which names the decorator, and `@MessagePattern` is the one a
  // third party writing the pattern key by hand is imitating. `nest-value-surface.spec.ts` is where
  // the day the framework stops writing either number becomes a failure.
  const kind: PatternHandlerKind =
    handlerType === NEST_PATTERN_HANDLERS.event ? 'event' : 'message';

  const reading: {
    -readonly [Key in keyof MicroserviceReading]: MicroserviceReading[Key];
  } = { kind, patterns, unreadablePatterns };

  const transport: unknown = reflect.getMetadata(NEST_MICROSERVICE_METADATA.transport, handler);
  if (typeof transport === 'number') {
    const name = NEST_TRANSPORT_NAMES[transport];
    const protocol = NEST_TRANSPORT_PROTOCOLS[transport];
    if (name === undefined || protocol === undefined) reading.unknownTransport = transport;
    else reading.transport = derived({ name, protocol });
  }

  return reading;
}

/**
 * What a `@WebSocketGateway` class declares.
 *
 * THE `port` OPTION IS NOT HERE, AND ITS ABSENCE IS A DECISION RATHER THAN AN OVERSIGHT. It was
 * read into a member of this interface until the review of `T051` measured that nothing read the
 * member back. A gateway's port is not part of the address `gatewayAddress` builds, because the
 * address a channel is filed under is the socket path and the namespace, and the host a reader
 * reaches the application at is a property of the deployment, which SPEC 8.3 already records as
 * the reason a synthesized server carries an empty host. A field written by this file and read by
 * nobody is a field that cannot be wrong, which is not the same as right.
 */
export interface GatewayReading {
  /** The path the gateway is served under, when the decorator names one. */
  readonly path?: string;
  /** The namespace, when the decorator names one. */
  readonly namespace?: string;
}

/**
 * Reads what `@WebSocketGateway` wrote on one class.
 *
 * BOTH HALVES OF THE ADDRESS COME OFF THE OPTIONS OBJECT, which `nest-surface.ts` records as a
 * measurement: the package exports a `NAMESPACE_METADATA` constant that the real decorator does
 * not write, and reading it would have found no namespace on every gateway that declares one.
 *
 * @param target - The gateway class
 * @returns What it declares, or nothing when the class is not a gateway
 */
export function readGateway(target: object): GatewayReading | undefined {
  const reflect = metadataReflect();
  if (reflect.getMetadata(NEST_WEBSOCKET_METADATA.gateway, target) !== true) return undefined;

  const options: unknown = reflect.getMetadata(NEST_WEBSOCKET_METADATA.options, target);
  const reading: { -readonly [Key in keyof GatewayReading]: GatewayReading[Key] } = {};
  if (!isRecord(options)) return reading;

  const path = options.path;
  const namespace = options.namespace;
  if (typeof path === 'string' && path !== '') reading.path = path;
  if (typeof namespace === 'string' && namespace !== '') reading.namespace = namespace;

  return reading;
}

/**
 * The event name one `@SubscribeMessage` handler answers.
 *
 * @param handler - The handler
 * @returns The event name, or nothing when the method is not a message mapping
 */
export function readSubscribeMessage(handler: object): string | undefined {
  const reflect = metadataReflect();
  if (reflect.getMetadata(NEST_WEBSOCKET_METADATA.messageMapping, handler) !== true) {
    return undefined;
  }

  const message: unknown = reflect.getMetadata(NEST_WEBSOCKET_METADATA.message, handler);
  return typeof message === 'string' && message !== '' ? message : undefined;
}

/**
 * The address of a WebSocket channel, per SPEC 8.3.
 *
 * THE PATH AND THE NAMESPACE ARE ONE ADDRESS AND NOT TWO FACTS. socket.io serves a namespace under
 * a path, so a client connects to `<path>` and then joins `<namespace>`; a reader who is given
 * only one of the two cannot reach the gateway. Both default to what socket.io defaults to, which
 * is `/socket.io` and `/`, and those defaults are the framework's rather than this package's.
 *
 * @param gateway - What the gateway class declares
 * @returns The address the channel is filed under
 */
export function gatewayAddress(gateway: GatewayReading): string {
  const path = gateway.path ?? DEFAULT_SOCKET_PATH;
  const namespace = gateway.namespace ?? '';
  const withSlash = namespace === '' || namespace.startsWith('/') ? namespace : `/${namespace}`;

  return `${path.replace(/\/+$/, '')}${withSlash}` || path;
}

/**
 * The path socket.io serves a gateway under when the decorator names none.
 *
 * IT IS THE FRAMEWORK'S DEFAULT AND NOT THIS PACKAGE'S CHOICE. socket.io mounts on `/socket.io`,
 * so a gateway that names no path is reachable there and a reference that said `/` would send a
 * reader to an address the application does not answer on.
 */
export const DEFAULT_SOCKET_PATH = '/socket.io';

/** The protocol every WebSocket gateway channel speaks, per SPEC 8.3. */
export const GATEWAY_PROTOCOL = NEST_WEBSOCKET_PROTOCOL;

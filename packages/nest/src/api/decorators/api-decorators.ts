/**
 * The six decorators of SPEC 13.4, which are how a person declares what no collector can observe.
 *
 * THEY ARE THE `declared` LEVEL OF SPEC 6.1, and that is the whole reason they exist. A collector
 * reads what the application happens to expose: a guard's class name, a throttler's configuration,
 * metadata under a key somebody else's decorator wrote. None of that says what an endpoint
 * promises. `@ApiScopes('orders:write')` does, and it is the one source this project treats as
 * authoritative, because a person wrote it in order to document the route.
 *
 * NOTHING HERE VALIDATES ITS ARGUMENT AGAINST THE APPLICATION. `@ApiScopes` does not check that a
 * guard enforces those scopes, and it must not: the whole point of SPEC 7 is that the declaration
 * and the observation are compared afterwards, by the drift engine, and a decorator that refused a
 * declaration disagreeing with the runtime would delete the evidence T022 exists to report.
 *
 * WHAT EACH ONE COSTS A CONSUMER IS ZERO NEW DEPENDENCIES. Three write metadata this package's own
 * collectors read; three write `x-` extensions straight into the object `@nestjs/swagger` builds
 * its operation from. See `metadata.ts` for why the second half needs no import of that package.
 */

import {
  OPENREF_EXTENSIONS,
  OPENREF_METADATA,
  setExtension,
  setOpenRefMetadata,
  type OpenRefDecorator,
} from './metadata';

/** Who a node is for, per SPEC 13.4. Mirrors the visibility of a mounted document. */
export type ApiAudience = 'public' | 'partner' | 'internal';

/** Transport a streaming endpoint uses, matching `IRStreaming` in the IR. */
export type ApiStreamKind = 'sse' | 'websocket' | 'chunked';

/** What `@ApiStream` accepts, per SPEC 13.4 and SPEC 13.6. */
export interface ApiStreamOptions {
  /**
   * The class of one item in the stream, which is level one of the SPEC 13.6 priority.
   *
   * A CLASS RATHER THAN A SCHEMA, because that is what the author has in hand at the decoration
   * site and it is what `@nestjs/swagger` already knows how to describe. The name is what reaches
   * the IR: an item type the document has no schema for is reported by `doctor` rather than
   * invented, per SPEC 6.1.
   */
  readonly itemType?: new (...args: never[]) => unknown;
  /** Transport. Defaults to `sse`, since that is the one `@Sse` produces. */
  readonly kind?: ApiStreamKind;
  /** The value the server sends to say the stream is over, such as `[DONE]`. */
  readonly terminator?: string;
  /** How often a keepalive is sent, when one is. */
  readonly heartbeatMs?: number;
}

/** One code sample, per SPEC 13.4. */
export interface ApiSampleOptions {
  /** Language identifier, as a highlighter reads it: `typescript`, `bash`, `python`. */
  readonly lang: string;
  /** What to call it in the UI, such as `SDK`. */
  readonly label?: string;
  /** The sample itself. */
  readonly source: string;
}

/** One request and response pair a person wrote, per SPEC 13.4. */
export interface ApiExampleOptions {
  /** What to call it, such as `Success`. */
  readonly name: string;
  /** The request body, as a value. */
  readonly request?: unknown;
  /** The response body, as a value. */
  readonly response?: unknown;
  /** One sentence about when this example applies. */
  readonly description?: string;
}

/**
 * Declares the scopes an endpoint requires, at `declared` confidence.
 *
 * @param scopes - Scope names, as the authorization system spells them
 * @returns The decorator
 */
export function ApiScopes(...scopes: readonly string[]): OpenRefDecorator {
  return setOpenRefMetadata(OPENREF_METADATA.scopes, [...scopes]);
}

/**
 * Declares the errors an endpoint answers with.
 *
 * THE CLASSES ARE STORED AS GIVEN, AND TURNING THEM INTO CONTRACTS IS T021. That task owns
 * `IRErrorContract`, the RFC 9457 shape and the three groups that must never be merged into one
 * list. What this decorator owns is the declaration itself, which is the only one of the three
 * groups a person writes.
 *
 * @param errors - Error classes, as the application defines them
 * @returns The decorator
 */
export function ApiErrors(...errors: readonly unknown[]): OpenRefDecorator {
  return setOpenRefMetadata(OPENREF_METADATA.errors, [...errors]);
}

/**
 * Declares what a streaming endpoint streams, which is level one of SPEC 13.6.
 *
 * @param options - Item type, transport, terminator
 * @returns The decorator
 */
export function ApiStream(options: ApiStreamOptions = {}): OpenRefDecorator {
  return setOpenRefMetadata(OPENREF_METADATA.stream, options);
}

/**
 * Marks who a node is for, as an extension in the served specification.
 *
 * IT MARKS AND DOES NOT HIDE. A node marked `internal` is still in this document; what reads the
 * marking is the agent surface of T058, which never exposes such a node, and a theme that wants to
 * badge it. Anything that has to be kept from a reader is kept by the visibility of the mounted
 * document, which is a guard rather than a field.
 *
 * @param audience - Who it is for
 * @returns The decorator
 */
export function ApiAudience(audience: ApiAudience): OpenRefDecorator {
  return setExtension(OPENREF_EXTENSIONS.audience, audience);
}

/**
 * Adds one code sample to a node.
 *
 * SAMPLES ACCUMULATE, because an endpoint documented in TypeScript and in curl has two, and the
 * decorator is applied twice. The list is kept in the order the decorators were applied, which
 * reads bottom to top in the source: JavaScript applies method decorators in that order, so this
 * reverses nothing and pretends nothing.
 *
 * @param sample - The sample
 * @returns The decorator
 */
export function ApiSample(sample: ApiSampleOptions): OpenRefDecorator {
  return setExtension(OPENREF_EXTENSIONS.samples, (existing: unknown) => [
    ...(Array.isArray(existing) ? (existing as unknown[]) : []),
    {
      lang: sample.lang,
      source: sample.source,
      ...(sample.label === undefined ? {} : { label: sample.label }),
    },
  ]);
}

/**
 * Adds one request and response pair to a node.
 *
 * AN EXTENSION RATHER THAN OPENAPI'S OWN `examples`, and the reason is that this decorator does
 * not know where they would go. An OpenAPI example belongs to one media type of one body, and a
 * method decorator sees neither: choosing `application/json` because it is the common case would
 * be exactly the guess SPEC 6.1 forbids one layer down. The pair is carried as data the renderer
 * shows and the specification keeps.
 *
 * @param example - The pair
 * @returns The decorator
 */
export function ApiExample(example: ApiExampleOptions): OpenRefDecorator {
  return setExtension(OPENREF_EXTENSIONS.examples, (existing: unknown) => [
    ...(Array.isArray(existing) ? (existing as unknown[]) : []),
    example,
  ]);
}

/** Direction of a channel as SPEC 8.2 spells it: what the application does with the message. */
export type ApiChannelDirection = 'send' | 'receive';

/**
 * What `@ApiChannel` accepts, per SPEC 8.3 and SPEC 13.4.
 *
 * EVERY MEMBER IS OPTIONAL BECAUSE THE DECORATOR OVERRIDES RATHER THAN REPLACES. A handler that
 * already carries `@MessagePattern('orders.created')` and wants only to say the protocol writes
 * `@ApiChannel({ protocol: 'amqp' })`, and the address stays the one the framework metadata gave.
 * A handler carrying no framework metadata at all declares the whole channel here, and then the
 * address is the one member it cannot do without: a channel with no address and no pattern is a
 * channel nothing can be said about.
 */
export interface ApiChannelOptions {
  /** Channel address: a topic, a queue name or a WebSocket path. */
  readonly address?: string;
  /** Protocol, as AsyncAPI spells it: `kafka`, `amqp`, `mqtt`, `ws`. */
  readonly protocol?: string;
  /** Which way the message travels. Defaults to `receive`, which is what a handler does. */
  readonly direction?: ApiChannelDirection;
  readonly title?: string;
  readonly summary?: string;
  readonly description?: string;
  /** Tag names, which group the channel in the navigation the way an operation's tags do. */
  readonly tags?: readonly string[];
}

/**
 * What `@ApiMessage` accepts, per SPEC 8.3 and SPEC 13.4.
 *
 * A CLASS OR A SCHEMA, AND A CLASS CONTRIBUTES ITS NAME AND NOTHING ELSE. This is the rule SPEC
 * 13.6 states for `@ApiStream({ itemType })` and it holds here for the same reason: reflection
 * cannot produce the shape of `OrderCreatedDto` from a class reference, so what reaches the
 * document is a reference to a schema of that name, and a name the document has no schema for
 * reaches `doctor` rather than being invented. A plain object is taken as the schema itself.
 */
export interface ApiMessageOptions {
  /** What the message carries. A class contributes its name; an object is the schema. */
  readonly payload?: (new (...args: never[]) => unknown) | Readonly<Record<string, unknown>>;
  /** The message headers, read the same way as `payload`. */
  readonly headers?: (new (...args: never[]) => unknown) | Readonly<Record<string, unknown>>;
  /** Name of the message, which is what the reference calls it. Defaults to the payload's. */
  readonly name?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly description?: string;
  /** Content type, such as `application/json`. */
  readonly contentType?: string;
  /** A runtime expression saying where the correlation id is found, per SPEC 8.2. */
  readonly correlationId?: string;
}

/**
 * Declares the channel a handler serves, at `declared` confidence, per SPEC 8.3.
 *
 * IT OUTRANKS WHAT THE FRAMEWORK METADATA SAYS, per SPEC 6.1: a person writing this is
 * documenting the endpoint, and `@MessagePattern`'s own arguments are a routing instruction that
 * happens to be readable. Where both are present, each member this decorator names wins and the
 * rest stay as they were read.
 *
 * @param channel - Address, protocol, direction and the prose around them
 * @returns The decorator
 */
export function ApiChannel(channel: ApiChannelOptions): OpenRefDecorator {
  return setOpenRefMetadata(OPENREF_METADATA.channel, channel);
}

/**
 * Declares the message a channel carries, at `declared` confidence, per SPEC 8.3.
 *
 * @param message - Payload, headers and the prose around them
 * @returns The decorator
 */
export function ApiMessage(message: ApiMessageOptions): OpenRefDecorator {
  return setOpenRefMetadata(OPENREF_METADATA.message, message);
}

/**
 * Declares the events a handler publishes, at `declared` confidence, per SPEC 9.
 *
 * THIS IS THE WHOLE OF THE TOPOLOGY POLICY IN ONE DECORATOR. SPEC 9 says relationships are
 * declared explicitly and that static analysis of what a handler publishes is unreliable and must
 * never be presented as fact. So there is no inference behind this: what a person writes here is
 * what the graph draws, and an application that writes nothing has a graph with nothing in it
 * rather than a graph of guesses.
 *
 * THE NAME IS AN EVENT AND NOT A NODE, per SPEC 9.1. `payment.created` is usually a channel some
 * other service documents, so the edge carries the name as an `event` end; matching it to a
 * channel by address happens once, in `@openref/core`, when the graph is built. An estate where
 * nobody documents the channel still gets the edge, drawn as a dead end, which is a fact worth
 * seeing rather than a link worth hiding.
 *
 * WRITING IT WITH NO NAME DECLARES NOTHING and produces a `doctor` problem rather than an edge,
 * per SPEC 9.4.
 *
 * @param events - Event names, as the estate spells them
 * @returns The decorator
 *
 * @example
 * @ApiPublishes('payment.created')
 * create() {}
 */
export function ApiPublishes(...events: readonly string[]): OpenRefDecorator {
  return setOpenRefMetadata(OPENREF_METADATA.publishes, events);
}

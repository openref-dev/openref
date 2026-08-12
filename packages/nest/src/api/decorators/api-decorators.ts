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

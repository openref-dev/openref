import type { IRJsonValue, IRSchemaSlot } from './schema.types';
import type { IRNodeRuntime, IRParameterLocation } from './runtime.types';

export type { IRParameterLocation } from './runtime.types';

/**
 * Node model. `IRNode` is a union discriminated by `kind`, per SPEC 5.1.
 *
 * The discriminant exists from M0 even though channels are unpopulated until M5. Retrofitting
 * the event model later would mean rewriting the core.
 */

/** The methods OpenAPI enumerates, including `query` from 3.2. */
export type IRStandardHttpMethod =
  'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace' | 'query';

/**
 * Method of an operation, always lowercase.
 *
 * OpenAPI 3.2 `additionalOperations` is keyed by method names the specification does not
 * enumerate, so the set is open and this is a string. {@link IRStandardHttpMethod} names the
 * ones that are enumerated, and `isStandardHttpMethod` reports which is which.
 */
export type IRHttpMethod = string;

// `IRParameterLocation` moved to `runtime.types.ts` in TX-COLLECTORS and is re-exported above,
// so every import site of this module keeps compiling and the public surface is unchanged.

/** Serialization style, the `style` axis of the runner contract matrix. */
export type IRParameterStyle =
  'matrix' | 'label' | 'simple' | 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject';

/** A named example, as it appears in an `examples` map. */
export interface IRExample {
  readonly summary?: string;
  readonly description?: string;
  readonly value?: IRJsonValue;
}

/** One parameter of an operation, with style and explode already resolved to defaults. */
export interface IRParameter {
  readonly name: string;
  readonly in: IRParameterLocation;
  readonly description?: string;
  readonly required: boolean;
  readonly deprecated?: boolean;
  readonly style: IRParameterStyle;
  readonly explode: boolean;
  readonly allowReserved?: boolean;
  readonly allowEmptyValue?: boolean;
  readonly schema?: IRSchemaSlot;
  readonly example?: IRJsonValue;
  readonly examples?: Readonly<Record<string, IRExample>>;
}

/** Per property serialization of a multipart or form encoded body. */
export interface IREncoding {
  readonly contentType?: string;
  readonly style?: IRParameterStyle;
  readonly explode?: boolean;
  readonly allowReserved?: boolean;
  readonly headers?: readonly IRHeader[];
}

/** One media type of a body or a response. */
export interface IRMediaType {
  readonly mediaType: string;
  readonly schema?: IRSchemaSlot;
  readonly example?: IRJsonValue;
  readonly examples?: Readonly<Record<string, IRExample>>;
  readonly encoding?: Readonly<Record<string, IREncoding>>;
}

/** A response header. */
export interface IRHeader {
  readonly name: string;
  readonly description?: string;
  readonly required: boolean;
  readonly deprecated?: boolean;
  readonly schema?: IRSchemaSlot;
}

/** Request body of an operation. */
export interface IRRequestBody {
  readonly description?: string;
  readonly required: boolean;
  readonly content: readonly IRMediaType[];
}

/**
 * One response of an operation.
 *
 * Responses are an ordered array rather than a map keyed by status code. Status codes are
 * integer like keys, which JavaScript objects iterate in numeric order rather than insertion
 * order, so a map here would make document order unrepresentable.
 */
export interface IRResponse {
  /** Status code as written, or `default`. */
  readonly statusCode: string;
  readonly description?: string;
  readonly headers?: readonly IRHeader[];
  readonly content: readonly IRMediaType[];
  /** OpenAPI 3.2 `itemSchema`, carried as is. */
  readonly itemSchema?: IRSchemaSlot;
}

/** A security requirement: one scheme plus the scopes it is required with. */
export interface IRSecurityRequirement {
  readonly schemeId: string;
  readonly scopes: readonly string[];
}

/**
 * One call sample written into the document, per SPEC 18.
 *
 * LEVEL 3 OF THE THREE, AND THE ONE WITH THE HIGHEST PRIORITY. SPEC 18 has the generator produce
 * cURL, TypeScript and Python from the same values the runner sends, and templates for six more
 * languages; both arrive in T057. What an author wrote by hand, through `@ApiSample` or as
 * `x-codeSamples` in the specification, outranks anything generated, so it is read first and the
 * generator fills in around it.
 */
export interface IRCodeSample {
  /** Language identifier, as a highlighter understands it, for example `bash` or `python`. */
  readonly lang: string;
  /** What the tab says. Defaults to the language when the document names none. */
  readonly label: string;
  readonly source: string;
}

/** An HTTP operation. */
export interface IROperation {
  readonly kind: 'operation';
  /** Stable identity of the node, per SPEC 5.4 and task T004. */
  readonly id: string;
  readonly method: IRHttpMethod;
  readonly path: string;
  /** Normalized operation id, for example `get-orders-id`. */
  readonly operationId?: string;
  /** Operation id exactly as the source document wrote it, for example `OrdersController_findAll`. */
  readonly rawOperationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly deprecated: boolean;
  readonly parameters: readonly IRParameter[];
  readonly requestBody?: IRRequestBody;
  readonly responses: readonly IRResponse[];
  readonly security: readonly IRSecurityRequirement[];
  /** Servers declared on the operation, overriding the document level list. */
  readonly servers: readonly IRServerOverride[];
  /** Callback node ids, keyed by callback name. */
  readonly callbacks?: Readonly<Record<string, readonly string[]>>;
  /** Call samples the document wrote, in the order it wrote them. Absent when it wrote none. */
  readonly codeSamples?: readonly IRCodeSample[];
  readonly runtime?: IRNodeRuntime;
  readonly extensions?: Readonly<Record<string, IRJsonValue>>;
  /**
   * Service this node came from, per SPEC 15. Absent in a document that was never merged.
   *
   * ADDITIVE AND OPTIONAL, per `T044`. It is on the node rather than on a list hanging off
   * {@link IRService} because every consumer that asks the question already holds the node: a
   * page badge, a search facet, the runner picking the server to call.
   */
  readonly serviceId?: string;
}

/** A server url declared at operation level. */
export interface IRServerOverride {
  readonly url: string;
  readonly description?: string;
}

/** Direction of a channel operation, per SPEC 8.2. */
export type IRChannelDirection = 'send' | 'receive';

/**
 * One variable of a templated channel address, per SPEC 8.2.
 *
 * THE FIVE MEMBERS ARE THE ASYNCAPI PARAMETER OBJECT'S OWN, taken from `spec/asyncapi.md` of
 * `asyncapi/spec` at both `v3.0.0` and `v3.1.0`, which declare the same set: `enum`, `default`,
 * `description`, `examples` and `location`. Nothing is invented here and nothing is folded into a
 * neighbouring field that means something else.
 *
 * ALL FIVE ARE OPTIONAL BECAUSE THE PARAMETER OBJECT REQUIRES NONE OF THEM, which is where this
 * parts company with {@link IRServerVariable}: OpenAPI's Server Variable Object requires `default`
 * and the IR carries that requirement, while AsyncAPI's Parameter Object requires nothing, so a
 * declared parameter that says only that the variable exists is a reading of the document rather
 * than an incomplete one.
 */
export interface IRChannelParameter {
  /** The values the substitution may take, when the document limits them to a set. */
  readonly enum?: readonly string[];
  /** What is substituted, and sent, when no alternate value is supplied. */
  readonly default?: string;
  readonly description?: string;
  readonly examples?: readonly string[];
  /** A runtime expression saying where in the message the value is found. */
  readonly location?: string;
}

/** A message that can travel over a channel. */
export interface IRMessage {
  readonly id: string;
  readonly name?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly contentType?: string;
  readonly payload?: IRSchemaSlot;
  readonly headers?: IRSchemaSlot;
  readonly correlationId?: string;
  /** Protocol bindings, kept verbatim. There is no OpenAPI analogue. */
  readonly bindings?: Readonly<Record<string, IRJsonValue>>;
  readonly examples?: Readonly<Record<string, IRExample>>;
  /**
   * Tag names, in the order the document wrote them, per SPEC 8.2.
   *
   * ADDITIVE AND OPTIONAL, added 2026-08-29 at `T049` on the event corpus's showing. Absent
   * where the document wrote no tag, which is the difference from {@link IRChannel.tags}: that
   * one is required and may be empty, because a required member cannot be added to a public type
   * without breaking every producer of it.
   */
  readonly tags?: readonly string[];
}

/**
 * The reply half of a request-reply operation, per SPEC 8.2.
 *
 * ALL THREE MEMBERS ARE OPTIONAL BECAUSE THE OPERATION REPLY OBJECT REQUIRES NONE OF THEM, and a
 * `reply` writing nothing at all is still carried, as the empty record: it says the operation is
 * one half of a request-reply pair, which is a fact an operation with no `reply` does not carry.
 */
export interface IRChannelReply {
  /**
   * Node id of the channel the reply travels on, when the document names one.
   *
   * IT MAY NAME A CHANNEL OTHER THAN THE OPERATION'S OWN, and usually does. This is the edge a
   * request-reply pair draws between two channels, and SPEC 9's topology graph is built from it.
   */
  readonly channelId?: string;
  /**
   * Ids of the reply messages, local to the reply channel rather than to the operation's own.
   *
   * Absent when the document names none. The "all messages of the channel" default that
   * {@link IRChannelOperation.messageIds} applies is deliberately not applied here: AsyncAPI
   * writes that default on the Operation Object and does not write it on the Operation Reply
   * Object, so applying it would be a default of this normalizer's invention.
   */
  readonly messageIds?: readonly string[];
  /**
   * A runtime expression saying where the reply is to be sent.
   *
   * The `location` of the Operation Reply Address Object and nothing else. Its `description` is
   * prose about the expression and is left where it was, the same choice
   * {@link IRMessage.correlationId} records.
   */
  readonly address?: string;
}

/** A `send` or `receive` operation on a channel. */
export interface IRChannelOperation {
  readonly id: string;
  readonly direction: IRChannelDirection;
  readonly summary?: string;
  readonly description?: string;
  /** Ids of the messages this operation carries, referring into the channel's own list. */
  readonly messageIds: readonly string[];
  readonly bindings?: Readonly<Record<string, IRJsonValue>>;
  /**
   * The reply of a request-reply operation, per SPEC 8.2. Absent on a one way operation.
   *
   * ADDITIVE AND OPTIONAL, added 2026-08-29 at `T049`. It is the most written of the six members
   * SPEC 8.2 had recorded as unheld: 13 positions across four of the 23 event corpus documents.
   */
  readonly reply?: IRChannelReply;
  /** Tag names, in the order the document wrote them. See {@link IRMessage.tags}. */
  readonly tags?: readonly string[];
  readonly runtime?: IRNodeRuntime;
}

/** An event channel: a topic, a queue or a WebSocket path. */
export interface IRChannel {
  readonly kind: 'channel';
  readonly id: string;
  /** Channel address, for example a topic name or a WebSocket path. */
  readonly address?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly deprecated: boolean;
  /** Protocol, for example `kafka`, `amqp` or `ws`. */
  readonly protocol?: string;
  /**
   * Variables of a templated address, keyed by the name written between the braces.
   *
   * ADDITIVE AND OPTIONAL, added 2026-08-29 by the maintainer's ruling ahead of `T049` and
   * recorded in SPEC 8.2 and `ai-docs/design/CONTRACT.md`. An address like `orders/{tenant}`
   * stops being readable without them: the braces name a variable and say nothing about what
   * goes in it, so dropping the block loses the half of the address that explains the other.
   * Absent on a channel whose address is not templated, and on one whose document wrote none.
   */
  readonly parameters?: Readonly<Record<string, IRChannelParameter>>;
  readonly servers: readonly IRServerOverride[];
  readonly operations: readonly IRChannelOperation[];
  readonly messages: readonly IRMessage[];
  readonly bindings?: Readonly<Record<string, IRJsonValue>>;
  readonly runtime?: IRNodeRuntime;
  readonly extensions?: Readonly<Record<string, IRJsonValue>>;
  /** Service this channel came from, per SPEC 15. Absent in a document that was never merged. */
  readonly serviceId?: string;
}

/**
 * A documented node: an HTTP operation or an event channel.
 *
 * Discriminated by `kind`, so exhaustiveness checking works at every use site.
 */
export type IRNode = IROperation | IRChannel;

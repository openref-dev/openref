import type { IRJsonValue, IRSchemaSlot } from './schema.types';
import type { IRNodeRuntime } from './runtime.types';

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

/** Where a parameter is carried. */
export type IRParameterLocation = 'path' | 'query' | 'header' | 'cookie';

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
  readonly runtime?: IRNodeRuntime;
  readonly extensions?: Readonly<Record<string, IRJsonValue>>;
}

/** A server url declared at operation level. */
export interface IRServerOverride {
  readonly url: string;
  readonly description?: string;
}

/** Direction of a channel operation, per SPEC 8.2. */
export type IRChannelDirection = 'send' | 'receive';

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
  readonly servers: readonly IRServerOverride[];
  readonly operations: readonly IRChannelOperation[];
  readonly messages: readonly IRMessage[];
  readonly bindings?: Readonly<Record<string, IRJsonValue>>;
  readonly runtime?: IRNodeRuntime;
  readonly extensions?: Readonly<Record<string, IRJsonValue>>;
}

/**
 * A documented node: an HTTP operation or an event channel.
 *
 * Discriminated by `kind`, so exhaustiveness checking works at every use site.
 */
export type IRNode = IROperation | IRChannel;

import type { IRHealthReport } from './health.types';
import type { IRNode } from './node.types';
import type { IRRelationship } from './relationship.types';
import type { IRRuntimeMeta } from './runtime.types';
import type { IRJsonValue, IRSchema } from './schema.types';

/**
 * Document model, per SPEC 5.1.
 *
 * `channels`, `relationships`, `webhooks`, `runtime` and `health` are declared from M0 and left
 * unpopulated until their milestone. Channels live in `nodes` under the `channel` discriminant
 * rather than in a separate collection, so one navigation and one search index cover both.
 */

/** Whether a document describes HTTP, events, or both. */
export type IRDocumentKind = 'http' | 'events' | 'mixed';

/** Contact details from the source document. */
export interface IRContact {
  readonly name?: string;
  readonly url?: string;
  readonly email?: string;
}

/** License of the described API. */
export interface IRLicense {
  readonly name: string;
  /** SPDX identifier, when the document gives one. */
  readonly identifier?: string;
  readonly url?: string;
}

/** Document metadata. */
export interface IRInfo {
  readonly title: string;
  readonly version: string;
  readonly summary?: string;
  readonly description?: string;
  readonly termsOfService?: string;
  readonly contact?: IRContact;
  readonly license?: IRLicense;
}

/** A templated part of a server url. */
export interface IRServerVariable {
  readonly default: string;
  readonly enum?: readonly string[];
  readonly description?: string;
}

/** A server the API is served from. Also a broker, for an event document. */
export interface IRServer {
  readonly url: string;
  readonly description?: string;
  /** Protocol, for AsyncAPI servers. */
  readonly protocol?: string;
  readonly protocolVersion?: string;
  readonly variables?: Readonly<Record<string, IRServerVariable>>;
}

/** What a navigation entry points at. */
export type IRNavNodeKind = 'group' | 'node' | 'schema' | 'page';

/** One entry in the navigation tree. */
export interface IRNavNode {
  readonly id: string;
  readonly label: string;
  readonly kind: IRNavNodeKind;
  /** Key into {@link IRDocument.nodes}, set when `kind` is `node`. */
  readonly nodeId?: string;
  /** Key into {@link IRDocument.schemas}, set when `kind` is `schema`. */
  readonly schemaId?: string;
  readonly deprecated?: boolean;
  readonly children: readonly IRNavNode[];
}

/** Kind of a security scheme. */
export type IRSecuritySchemeType = 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS';

/**
 * One OAuth2 flow with its scopes.
 *
 * `pkceRequired` WAS HERE AND WAS REMOVED BY T028, WITH NOTHING PUT IN ITS PLACE. No producer ever
 * filled it and no consumer ever read it, and the only two things it could have meant were both
 * wrong. Read as true it says what SPEC 14.4 already says unconditionally; read as false or absent
 * it says PKCE is optional, which is a switch for turning off the one rule the authorization code
 * flow is not allowed to negotiate. A field whose only reachable use is to weaken a mandatory rule
 * is a defect rather than a feature nobody got round to.
 */
export interface IROAuthFlow {
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly refreshUrl?: string;
  /** OpenAPI 3.2 `deviceAuthorizationUrl`, where the device flow of RFC 8628 starts. */
  readonly deviceAuthorizationUrl?: string;
  readonly scopes: Readonly<Record<string, string>>;
}

/** OAuth2 flows, keyed by flow name as written in the document. */
export interface IROAuthFlows {
  readonly implicit?: IROAuthFlow;
  readonly password?: IROAuthFlow;
  readonly clientCredentials?: IROAuthFlow;
  readonly authorizationCode?: IROAuthFlow;
  /** OpenAPI 3.2 `deviceAuthorization`. */
  readonly deviceAuthorization?: IROAuthFlow;
}

/** A security scheme the API can be called with. */
export interface IRSecurityScheme {
  readonly id: string;
  readonly type: IRSecuritySchemeType;
  readonly description?: string;
  /** Name of the header, query parameter or cookie, for `apiKey`. */
  readonly name?: string;
  readonly in?: 'query' | 'header' | 'cookie';
  /** HTTP authentication scheme, for `http`. */
  readonly scheme?: string;
  readonly bearerFormat?: string;
  readonly openIdConnectUrl?: string;
  readonly flows?: IROAuthFlows;
}

/**
 * The whole reference, normalized and deterministic.
 *
 * `nodes`, `schemas` and `webhooks` are maps because lookup by id is the dominant access
 * pattern. Canonical serialization writes a `Map` as a sorted array of pairs, so map ordering
 * never affects {@link IRDocument.hash}.
 */
export interface IRDocument {
  /** Stable identity of the document, used as the federation key. */
  readonly id: string;
  readonly kind: IRDocumentKind;
  /** sha256 over the canonical serialization of this document with `hash` blanked. */
  readonly hash: string;
  readonly info: IRInfo;
  readonly servers: readonly IRServer[];
  readonly navigation: readonly IRNavNode[];
  readonly nodes: ReadonlyMap<string, IRNode>;
  readonly schemas: ReadonlyMap<string, IRSchema>;
  readonly security: readonly IRSecurityScheme[];
  readonly relationships: readonly IRRelationship[];
  readonly webhooks: ReadonlyMap<string, IRNode>;
  readonly runtime?: IRRuntimeMeta;
  readonly health?: IRHealthReport;
  readonly extensions?: Readonly<Record<string, IRJsonValue>>;
}

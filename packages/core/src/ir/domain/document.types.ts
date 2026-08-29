import type { IRHealthReport } from './health.types';
import type { IRNode, IRSecurityRequirement } from './node.types';
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
  /**
   * Protocol bindings of the server, kept verbatim, keyed by protocol name, per SPEC 8.2.
   *
   * ADDITIVE AND OPTIONAL, added 2026-08-29 at `T049` on the event corpus's showing. OpenAPI's
   * Server Object declares no such member, so an HTTP document leaves this absent always, and
   * that absence is the absence of a subject rather than something lost on the way in.
   */
  readonly bindings?: Readonly<Record<string, IRJsonValue>>;
  /**
   * What a connection to this server has to satisfy, per SPEC 8.2. Absent when nothing was said.
   *
   * ADDITIVE AND OPTIONAL, added 2026-08-29 at `T051`; the breaking half of the same change is
   * the growth of {@link IRSecuritySchemeType}. AsyncAPI writes a Server Object's `security` as a
   * list of Security Scheme Objects rather than as a list of requirements naming a table, and this
   * carries requirements anyway: the schemes go once into `IRDocument.security`, and a position
   * names one, so one scheme used by three servers is one entry and not three copies a reader
   * cannot tell from three schemes that happen to match.
   *
   * PRESENT AND EMPTY IS NOT THE SAME AS ABSENT. A document that wrote `security: []` said there
   * are none; a document that wrote nothing said nothing. OpenAPI's Server Object has no such
   * member, so an HTTP document leaves this absent always.
   */
  readonly security?: readonly IRSecurityRequirement[];
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
  /**
   * Key into {@link IRDocument.services}, set on the group a federated merge builds per service.
   *
   * ADDITIVE AND OPTIONAL, per SPEC 15.3, so a document built before `T046` is still a document
   * and an unmerged one carries nothing here. It exists because the navigation is where a
   * service's health has to be visible from anywhere on the page, and parsing the group's id
   * back into a service id would break the day a clash escapes the id.
   */
  readonly serviceId?: string;
  readonly deprecated?: boolean;
  readonly children: readonly IRNavNode[];
}

/**
 * Kind of a security scheme, over both specifications this IR reads.
 *
 * FOURTEEN NAMES, GROWN FROM FIVE ON 2026-08-29 AT `T051`, and the growth is breaking rather than
 * additive: a consumer holding a total `Record<IRSecuritySchemeType, ...>` or switching over this
 * union exhaustively does not compile against it. Recorded in `ai-docs/design/CONTRACT.md` before
 * the code, beside `IRDiffChangeKind` and `PageKind`, which are the same event.
 *
 * FIVE FROM OPENAPI AND THIRTEEN FROM ASYNCAPI, OVERLAPPING IN FOUR. `apiKey`, `http`, `oauth2`
 * and `openIdConnect` are written by both; `mutualTLS` is OpenAPI's alone and the other nine are
 * AsyncAPI's alone. SPEC 8.2 carries the whole thirteen type mapping with each type's disposition.
 *
 * `apiKey` MEANS TWO DIFFERENT THINGS AND {@link IRSecurityScheme.in} IS WHAT TELLS THEM APART.
 * OpenAPI's is a key in a header, a query parameter or a cookie and requires a `name`; AsyncAPI's
 * is a key substituted into the connection's user or password field and has no `name` at all. Two
 * names in this union would rename what both specifications call one word, and a reader would meet
 * a type that appears in neither source document.
 */
export type IRSecuritySchemeType =
  /** OpenAPI: a key in a header, query parameter or cookie. AsyncAPI: a key as user or password. */
  | 'apiKey'
  | 'http'
  | 'oauth2'
  | 'openIdConnect'
  /** OpenAPI's alone. AsyncAPI writes `X509` for the certificate half of the same idea. */
  | 'mutualTLS'
  /** AsyncAPI: user and password over the transport's own mechanism. */
  | 'userPassword'
  /** AsyncAPI: a client certificate. */
  | 'X509'
  /** AsyncAPI: end to end encryption with a shared key. */
  | 'symmetricEncryption'
  /** AsyncAPI: end to end encryption with a key pair. */
  | 'asymmetricEncryption'
  /** AsyncAPI: a key in a header, query parameter or cookie, which is OpenAPI's `apiKey`. */
  | 'httpApiKey'
  /** AsyncAPI: SASL PLAIN, per RFC 4422. */
  | 'plain'
  /** AsyncAPI: SASL SCRAM with SHA-256. */
  | 'scramSha256'
  /** AsyncAPI: SASL SCRAM with SHA-512. */
  | 'scramSha512'
  /** AsyncAPI: SASL GSSAPI. */
  | 'gssapi';

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
  /** Name of the header, query parameter or cookie, for `apiKey` and for `httpApiKey`. */
  readonly name?: string;
  /**
   * Where the key travels.
   *
   * FIVE VALUES SINCE `T051`, GROWN FROM THREE, AND THE GROWTH IS BREAKING. `user` and `password`
   * are AsyncAPI's, and its `apiKey` requires one of the two: the key is substituted into the
   * connection's user or password field rather than into anything HTTP has. Carrying the type and
   * dropping the location would put a scheme in the IR that says `apiKey` and says nothing about
   * where the key goes, which is the partial picture the empty `security` of `T048` refused.
   * `query`, `header` and `cookie` are the three that were already here, and they are what
   * OpenAPI's `apiKey` and AsyncAPI's `httpApiKey` both use.
   */
  readonly in?: 'query' | 'header' | 'cookie' | 'user' | 'password';
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
  /**
   * The services this document was merged from, per SPEC 15. Absent when it is one service's own.
   *
   * ADDITIVE AND OPTIONAL, so a document built before `T044` is still a document, and a document
   * that was never merged carries nothing here rather than a list of one. Present, it is sorted
   * by `IRService.id` and it holds everything document level that a source document said, because
   * merging is lossless: what a service declared about itself has nowhere else to go once its
   * nodes have moved into a shared map.
   */
  readonly services?: readonly IRService[];
  /**
   * Path item keys the normalizer would not read, per SPEC 7.1's `operation-key-unread`.
   *
   * ADDITIVE AND OPTIONAL, so a document built before `T043` is still a document. It exists
   * because a fact that cannot be obtained has to reach the doctor rather than be dropped: an
   * operation written under `GET` instead of `get` used to vanish with nothing anywhere saying
   * so, and `diff` then reported a deletion nobody made.
   */
  readonly unreadKeys?: readonly IRUnreadKey[];
}

/**
 * One service inside a federated document, per SPEC 15.
 *
 * WHAT IT IS, AND WHY IT IS NOT A TAG. Merging moves a service's nodes, schemas and security
 * schemes into one shared document, and every one of them can be renamed on the way. What is
 * left over is the document header the service wrote about itself: its title, its version, its
 * servers, the collectors that ran on it and the health it reported. None of that survives being
 * folded into the merged header, so it is kept here per service rather than dropped, which is
 * the whole of what `lossless` means for the document level.
 *
 * A NODE POINTS BACK RATHER THAN BEING LISTED HERE. `IROperation.serviceId` and
 * `IRChannel.serviceId` name the service, so membership is stated once at the place a consumer
 * already has in its hand. A list of ids here would be the same fact written twice, and the
 * second copy is the one that goes stale.
 */
export interface IRService {
  /** Service identity, as the federation configuration names it. Unique within the document. */
  readonly id: string;
  /** `IRDocument.id` of the source document, which is not always the service id. */
  readonly documentId: string;
  /** `IRDocument.hash` of the source document, so a refreshed remote is detectable. */
  readonly documentHash: string;
  readonly kind: IRDocumentKind;
  readonly info: IRInfo;
  readonly servers: readonly IRServer[];
  /** Path prefix every address of this service was moved under, when one applied. */
  readonly prefix?: string;
  readonly runtime?: IRRuntimeMeta;
  readonly health?: IRHealthReport;
  readonly extensions?: Readonly<Record<string, IRJsonValue>>;
  /**
   * The service's own unread path item keys, with the paths exactly as its document wrote them.
   *
   * THEY STAY HERE AND ARE NOT UNIONED UPWARDS, because {@link IRUnreadKey.path} promises the
   * path the document wrote and a merged address is a path no document wrote. Rewriting it to
   * the merged form would break that promise to make one list; keeping the source form in a
   * merged list would name an address the merged document does not answer.
   */
  readonly unreadKeys?: readonly IRUnreadKey[];
}

/** One path item key that named an operation this normalizer does not read. */
export interface IRUnreadKey {
  /** The path it was written under, exactly as the document wrote it. */
  readonly path: string;
  /** The key, exactly as the document wrote it. */
  readonly key: string;
  /** The method it would have been, had the key been spelled the way OpenAPI spells one. */
  readonly method: string;
}

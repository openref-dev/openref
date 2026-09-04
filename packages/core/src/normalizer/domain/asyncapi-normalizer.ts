import { compareByCodePoint } from '../../hashing/domain/canonical';
import { finalizeDocument } from '../../hashing/domain/hash';
import type {
  IRDocument,
  IROAuthFlow,
  IROAuthFlows,
  IRSecurityScheme,
  IRSecuritySchemeType,
  IRServer,
} from '../../ir/domain/document.types';
import type {
  IRChannel,
  IRChannelDirection,
  IRChannelOperation,
  IRChannelParameter,
  IRChannelReply,
  IRExample,
  IRMessage,
  IRNode,
  IRSecurityRequirement,
  IRServerOverride,
} from '../../ir/domain/node.types';
import type { IRRelationship } from '../../ir/domain/relationship.types';
import type { IRJsonValue, IRSchema } from '../../ir/domain/schema.types';
import { ErrorCode } from '../../shared/errors/codes';
import {
  CycleDepthError,
  RefResolutionError,
  UnsupportedDialectError,
} from '../../shared/errors/index';
import { dialectFromSchemaFormat, isJsonSchemaCompatible } from './dialect';
import {
  collectNamedSchemas,
  documentSlug,
  invalidDocument,
  produceDeclaredSchemas,
  readExtensions,
  readInfo,
  readServerVariables,
  readTagNames,
  readTags,
  schemaOptions,
  schemaSlot,
  type SchemaContext,
} from './document-parts';
import { asJsonValue, asString, isPlainObject, isUnknownArray } from './guards';
import { buildNavigation } from './navigation';
import {
  structuralReferenceChain,
  type StructuralReferenceChain as ReferenceChain,
} from './json-pointer';
import { pathSlug } from './operation-identity';
import { orderRelationships } from '../../topology/domain/relationships';
import { normalizeSchema } from './schema-normalizer';
import { createSchemaRegistry } from './schema-registry';

/**
 * AsyncAPI intake for 3.0 and 3.1, per SPEC 8.1, SPEC 8.2 and SPEC 5.2.
 *
 * EVENTS AND HTTP ARE ONE MODEL AND NOT TWO PIPELINES. What comes out of here is an
 * {@link IRDocument} of the same shape an OpenAPI document produces: channels are nodes under the
 * `channel` discriminant of SPEC 5.1, named schemas live in the one map of SPEC 5.1.1, the
 * navigation is built by the same builder, and the hash is taken the same way. Nothing downstream
 * of `core` learns which specification a document was written in, which is the whole point of the
 * discriminant having been reserved since M0.
 *
 * 3.1 IS A BACKWARDS COMPATIBLE MINOR OF 3.0 AND THE VERSION DOES NOT REACH THE IR. Per SPEC 8.1
 * the target format is 3.1 for both inputs, and 3.1 adds one protocol binding to a set this
 * normalizer carries verbatim whatever it is called. So a 3.0 document and the same document
 * declaring 3.1 normalize to one IR with one hash, and the version string is read to be refused
 * or accepted rather than to be recorded.
 *
 * ORDERING IS CANONICAL RATHER THAN TAKEN FROM OBJECT ITERATION, for the reason SPEC 5.3 gives.
 * AsyncAPI keys `servers`, `channels`, `operations` and a channel's `messages` by name, and a
 * parsed object hands those back in an order no document controls once a key looks like an
 * integer. Every one of them is walked in code point order of its key.
 */

/** Options for {@link normalizeAsyncApiDocument}. */
export interface NormalizeAsyncApiOptions {
  /** Identity of the document, used as the federation key. Defaults to a slug of the title. */
  readonly documentId?: string;
  /** Documents that external schema references point at, keyed by the URI before the `#`. */
  readonly externalDocuments?: Readonly<Record<string, unknown>>;
  /** Limit on how deeply anonymous schemas may nest. */
  readonly cycleDepth?: number;
}

const SUPPORTED_ASYNCAPI_MAJOR_MINOR = ['3.0', '3.1'];

/**
 * What separates a channel node id from an operation node id, per SPEC 5.4.
 *
 * An operation id is `<method>-<path-slug>` and a channel id is this plus a slug of the address,
 * so the two cannot meet inside one document. They have to share `IRDocument.nodes`, and a mixed
 * HTTP and events document is the point of the milestone rather than an edge case, so a channel
 * called `get/orders` must not be able to take the id of `GET /orders`.
 */
const CHANNEL_ID_PREFIX = 'channel-';

/** A mutable draft of an IR value, so optional members can be filled in conditionally. */
type Draft<Value> = { -readonly [Key in keyof Value]: Value[Key] };

/**
 * How deep the merge of a trait into its target may go before it is refused.
 *
 * DECLARED RATHER THAN INHERITED FROM THE STACK, per SPEC 5.3's second finding. The merge
 * descends only where both sides hold an object at one key, which a document written by hand
 * never does more than a couple of levels, but a YAML alias can make a value that contains
 * itself, and an undeclared limit turns that into a bare `RangeError` instead of a refusal.
 */
const MAX_TRAIT_MERGE_DEPTH = 12;

interface Context extends SchemaContext {
  /** Every server the document declares, keyed by the name it declares it under. */
  readonly servers: ReadonlyMap<string, IRServer>;
  /** The name of a server, keyed by the object a reference to it resolves to. */
  readonly serverNames: ReadonlyMap<object, string>;
  /** Document level `defaultContentType`, which a message with none of its own inherits. */
  readonly defaultContentType: string | undefined;
  /** The security schemes of the document, filled in place, keyed by the id each ended up with. */
  readonly securitySchemes: Map<string, IRSecurityScheme>;
  /**
   * The declared name of a security scheme, keyed by every object that names its position.
   *
   * Read with {@link positionOf} for the reason channels, messages and servers are: a `$ref`
   * wrapper belongs to one position and the object it points at may be shared by many, so two
   * servers referring to one scheme name the same entry rather than making a second.
   */
  readonly securitySchemeNames: Map<object, string>;
}

/**
 * What this document calls the thing a structural reference names, for the message an external
 * reference is refused with.
 */
const REFERENCE_SUBJECT = 'a channel, message or server';

/**
 * Walks a chain of `$ref` members to the value a structural reference names.
 *
 * THE CHAIN IS THE PART THAT MATTERS, AND KEEPING ONLY ITS LAST LINK IS A BUG THE EVENT CORPUS
 * FOUND. Two channels may reference one Message Object in `components`, which the AsyncAPI
 * Initiative's own streetlights examples do for `turnOnOff`, and then the resolved object is the
 * same object for both channels. Identity of the target therefore does not identify a position,
 * while identity of the link written at the position does, because a `$ref` wrapper is written
 * once per position. See {@link positionOf}.
 *
 * THE WALK ITSELF LIVES IN `json-pointer.ts` and is shared with the OpenAPI reader, which reached
 * `T052` without one. This is the document-typed wrapper over it, so every call site here keeps
 * naming the context it already had.
 *
 * @param context - The document being normalized
 * @param value - The member as written, which may or may not be a reference
 * @param where - What is being resolved, for the message a reader gets
 * @returns Every object stood on, and the value the last link names
 * @throws {RefResolutionError} When the reference leaves the document or resolves to nothing
 * @throws {CycleDepthError} When the chain of references returns to where it has been
 */
function referenceChain(context: Context, value: unknown, where: string): ReferenceChain {
  return structuralReferenceChain(context.document, value, where, REFERENCE_SUBJECT);
}

/**
 * Follows a chain of `$ref` members to the object a structural reference names.
 *
 * @param context - The document being normalized
 * @param value - The member as written, which may or may not be a reference
 * @param where - What is being resolved, for the message a reader gets
 * @returns The object the reference names, or the value itself when it is not one
 * @throws {RefResolutionError} When the reference leaves the document or resolves to nothing
 * @throws {CycleDepthError} When the chain of references returns to where it has been
 */
function followReference(context: Context, value: unknown, where: string): unknown {
  return referenceChain(context, value, where).value;
}

/**
 * The position a reference names, taken from the nearest link of its chain that is a known one.
 *
 * WHY NEAREST AND NOT LAST. `#/channels/lightTurnOff/messages/turnOff` resolves in two hops: the
 * `$ref` wrapper written at that position, then the Message Object in `components` the wrapper
 * points at. The wrapper belongs to exactly one channel; the Message Object may belong to several,
 * and in the streetlights examples it belongs to two. Reading the last link asks "which channel
 * holds this object", which has no single answer, and the map built from it kept whichever channel
 * was walked last. Reading the nearest known link asks "which position was named", which is the
 * question, and it has one answer.
 *
 * @param known - Positions by every object that identifies one, both wrappers and targets
 * @param chain - The chain, nearest first
 * @returns The position, or nothing when no link of the chain names one
 */
function positionOf<Position>(
  known: ReadonlyMap<object, Position>,
  chain: readonly object[],
): Position | undefined {
  for (const link of chain) {
    const found = known.get(link);
    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * Merges one trait underneath its target, by the rule AsyncAPI states for traits.
 *
 * A PROPERTY OF A TRAIT NEVER OVERRIDES THE SAME PROPERTY OF THE TARGET, which is the sentence
 * the specification uses, and the merge is the JSON Merge Patch shape rather than a shallow
 * assignment: a trait declaring `bindings.amqp` and a message declaring `bindings.kafka` leave
 * both bindings standing, where an assignment would leave one.
 *
 * @param target - The object the trait is applied to
 * @param trait - The trait
 * @param depth - How far down the merge already is
 * @returns The merged object
 * @throws {CycleDepthError} Past {@link MAX_TRAIT_MERGE_DEPTH}
 */
function mergeTrait(target: unknown, trait: unknown, depth: number): unknown {
  if (!isPlainObject(target) || !isPlainObject(trait)) return target;

  if (depth > MAX_TRAIT_MERGE_DEPTH) {
    throw new CycleDepthError(
      `a trait nests deeper than the ${String(MAX_TRAIT_MERGE_DEPTH)} levels this merges`,
      ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED,
      undefined,
      { limit: MAX_TRAIT_MERGE_DEPTH },
    );
  }

  const merged: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(trait)) {
    merged[key] = Object.hasOwn(merged, key) ? mergeTrait(merged[key], value, depth + 1) : value;
  }

  return merged;
}

/**
 * Applies the `traits` of an operation or a message, in the order the document declares them.
 *
 * TRAITS ARE READ BECAUSE NOT READING THEM LOSES FIELDS IN SILENCE. A document that puts an
 * operation's bindings in a trait, which the reference AsyncAPI examples do, would otherwise
 * normalize to an operation with no bindings and nothing anywhere saying it had any. Nothing
 * about the merge is a guess: it is the specification's own mechanism, applied in the
 * specification's own order.
 *
 * @param context - The document being normalized
 * @param source - The object as written, resolved
 * @param where - What is being merged, for the message a reader gets
 * @returns The object with its traits underneath it, or the object itself when it declares none
 */
function applyTraits(
  context: Context,
  source: Record<string, unknown>,
  where: string,
): Record<string, unknown> {
  const traits = source.traits;
  if (!isUnknownArray(traits)) return source;

  let merged: Record<string, unknown> = source;
  for (const [index, entry] of traits.entries()) {
    const trait = followReference(context, entry, `trait ${String(index)} of ${where}`);
    const result = mergeTrait(merged, trait, 0);
    if (isPlainObject(result)) merged = result;
  }

  return merged;
}

/**
 * Reads the Protocol Bindings of a channel, an operation or a message, verbatim.
 *
 * THIS IS THE ONE PART OF AN ASYNCAPI DOCUMENT WITH NO OPENAPI ANALOGUE, per SPEC 8.2, so there
 * is nothing to reduce it to. A partition key, an exchange type and a QoS level are read by
 * whoever knows the protocol, and this normalizer is not that reader: the block is carried as
 * written, keyed by the protocol name the document used, and a binding for a protocol invented
 * after this code was written survives exactly as one for a protocol that predates it.
 *
 * @param raw - The `bindings` member, untrusted
 * @returns The bindings keyed by protocol name, or nothing when there are none
 */
function readBindings(raw: unknown): Record<string, IRJsonValue> | undefined {
  if (!isPlainObject(raw)) return undefined;

  const bindings: Record<string, IRJsonValue> = {};
  for (const protocol of Object.keys(raw).sort(compareByCodePoint)) {
    const value = asJsonValue(raw[protocol]);
    if (value !== undefined) bindings[protocol] = value;
  }

  return Object.keys(bindings).length > 0 ? bindings : undefined;
}

/**
 * Reads the servers a document declares, keyed by name.
 *
 * `url` IS RECONSTRUCTED, BECAUSE ASYNCAPI 3 DOES NOT WRITE ONE. It splits what 2.x called a url
 * into `host`, `pathname` and `protocol`, and {@link IRServer} carries a url and a protocol
 * beside it, so the url is `<protocol>://<host><pathname>` and the protocol also stands on its
 * own field. Nothing here treats that url as an HTTP address: SPEC 14.5's allowlist reads it,
 * finds a scheme its proxy does not speak, and reports the server as one it cannot reach, which
 * is the correct answer for a broker.
 *
 * A server missing `host` or `protocol` is skipped, the way a server object with no url is
 * skipped on the OpenAPI side. Both are required members, and a declaration that carries neither
 * an address nor a way to speak to it names nothing.
 *
 * AN EMPTY HOST BUILDS NO URL AT ALL, per SPEC 8.2, AND THAT IS A FIX RATHER THAN A REFINEMENT.
 * The presence guard above is satisfied by an empty string, because an empty string is a string,
 * so `{ host: '', protocol: 'kafka' }` assembled `kafka://` and every surface that prints a url
 * printed it: the overview's server list, the channel's server row, and the socket console, which
 * joined it to the address and offered `kafka://orders.created` as a target. That is the class
 * CLAUDE.md rule 5 names, a fact that could not be obtained replaced by a guess, and the guess
 * reached a reader as a broker address. The server itself stays, with its protocol, because SPEC
 * 8.3 keeps it: a channel with no server is a channel with no protocol. What it loses is the url
 * it never had.
 *
 * @param context - The document being normalized, with an empty server map
 * @param raw - The `servers` member, untrusted
 * @returns The servers by declared name, in code point order of that name
 */
function readAsyncApiServers(context: Context, raw: unknown): Map<string, IRServer> {
  const servers = new Map<string, IRServer>();
  if (!isPlainObject(raw)) return servers;

  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const source = followReference(context, raw[name], `server ${name}`);
    if (!isPlainObject(source)) continue;

    const host = asString(source.host);
    const protocol = asString(source.protocol);
    if (host === undefined || protocol === undefined) continue;

    const server: Draft<IRServer> = {
      url: host === '' ? '' : `${protocol}://${host}${asString(source.pathname) ?? ''}`,
      protocol,
    };

    const description = asString(source.description);
    const protocolVersion = asString(source.protocolVersion);
    if (description !== undefined) server.description = description;
    if (protocolVersion !== undefined) server.protocolVersion = protocolVersion;

    const variables = readServerVariables(source.variables);
    if (variables !== undefined) server.variables = variables;

    const bindings = readBindings(source.bindings);
    if (bindings !== undefined) server.bindings = bindings;

    const security = readSecurityDeclarations(context, source.security, name, 'servers');
    if (security !== undefined) server.security = security;

    servers.set(name, server);
  }

  return servers;
}

/**
 * The thirteen security scheme types AsyncAPI 3 declares, in the order its own table names them.
 *
 * QUOTED FROM THE SPECIFICATION RATHER THAN COLLECTED FROM THE CORPUS. `spec/asyncapi.md` of
 * `asyncapi/spec` at `v3.0.0` and `v3.1.0`, Security Scheme Object, `type`: "Valid values are
 * `userPassword`, `apiKey`, `X509`, `symmetricEncryption`, `asymmetricEncryption`, `httpApiKey`,
 * `http`, `oauth2`, `openIdConnect`, `plain`, `scramSha256`, `scramSha512`, and `gssapi`". Both
 * editions carry that sentence word for word. Five of the thirteen appear in no document of the
 * event corpus, and they are here anyway: the union is read from the specification's table whole
 * or not at all, and a partially read one is the half picture SPEC 8.2 spent two tasks refusing.
 *
 * A TYPE OUTSIDE THE TABLE IS A REFUSAL AND NOT A SKIP, per SPEC 8.2, and it was a skip until the
 * review of `T051` measured what a skip prints. A server writing `security: [{ type: 'bearerToken' }]`
 * normalized to `security: []` at that position, and an empty list is this reader's own spelling of
 * "the document said there are none" while the document said there is one. That is a false sentence
 * where an absent one belongs, which is the defect the holding position existed to refuse, one level
 * down. `type` is REQUIRED by the Security Scheme Object, and this normalizer is fail closed where a
 * member is required.
 */
const ASYNCAPI_SECURITY_SCHEME_TYPES = [
  'userPassword',
  'apiKey',
  'X509',
  'symmetricEncryption',
  'asymmetricEncryption',
  'httpApiKey',
  'http',
  'oauth2',
  'openIdConnect',
  'plain',
  'scramSha256',
  'scramSha512',
  'gssapi',
] as const satisfies readonly IRSecuritySchemeType[];

/**
 * Where AsyncAPI puts an API key, by the type that carries the member.
 *
 * TWO VOCABULARIES UNDER ONE MEMBER NAME, WHICH IS THE SPECIFICATION'S OWN ARRANGEMENT. The
 * Security Scheme Object's `in` is REQUIRED for `apiKey` with the values `user` and `password`,
 * and REQUIRED for `httpApiKey` with `query`, `header` and `cookie`. Both sets are checked here
 * rather than one, because a value outside the pair its own type declares is not a location this
 * reader can pass on to anybody.
 */
const ASYNCAPI_KEY_LOCATIONS: Readonly<
  Record<string, readonly NonNullable<IRSecurityScheme['in']>[]>
> = {
  apiKey: ['user', 'password'],
  httpApiKey: ['query', 'header', 'cookie'],
};

/** The four OAuth flows AsyncAPI's OAuth Flows Object declares, which are OpenAPI's four. */
const ASYNCAPI_OAUTH_FLOWS = [
  'implicit',
  'password',
  'clientCredentials',
  'authorizationCode',
] as const satisfies readonly (keyof IROAuthFlows)[];

/**
 * Reads one AsyncAPI OAuth Flow Object.
 *
 * `availableScopes` AND NOT `scopes`, AND THE TWO ARE DIFFERENT FACTS. AsyncAPI's OAuth Flow
 * Object names its scope dictionary `availableScopes`, where OpenAPI names the same dictionary
 * `scopes`, so both land in `IROAuthFlow.scopes`. The `scopes` AsyncAPI writes on the Security
 * Scheme Object itself is the other fact, the list of scopes needed at the position, and it goes
 * to the requirement rather than here.
 *
 * @param raw - The flow object, untrusted
 * @returns The flow, or nothing when there is no object here
 */
function readAsyncApiOAuthFlow(raw: unknown): IROAuthFlow | undefined {
  if (!isPlainObject(raw)) return undefined;

  const scopes: Record<string, string> = {};
  if (isPlainObject(raw.availableScopes)) {
    for (const name of Object.keys(raw.availableScopes).sort(compareByCodePoint)) {
      scopes[name] = asString(raw.availableScopes[name]) ?? '';
    }
  }

  const flow: Draft<IROAuthFlow> = { scopes };
  const authorizationUrl = asString(raw.authorizationUrl);
  const tokenUrl = asString(raw.tokenUrl);
  const refreshUrl = asString(raw.refreshUrl);
  if (authorizationUrl !== undefined) flow.authorizationUrl = authorizationUrl;
  if (tokenUrl !== undefined) flow.tokenUrl = tokenUrl;
  if (refreshUrl !== undefined) flow.refreshUrl = refreshUrl;

  return flow;
}

/**
 * Reads one Security Scheme Object into the IR, under the id it is to be filed as.
 *
 * ONLY THE MEMBERS THE TYPE DECLARES ARE READ, per the "Applies To" column of the specification's
 * own table, so a `plain` scheme carrying a stray `scheme` member does not acquire an HTTP
 * authentication scheme it does not have. SPEC 8.2 carries the whole mapping.
 *
 * THE REFUSAL NAMES THE POSITION AND NOT ONLY THE TYPE, because the reader who acts on it edits the
 * document rather than this file, and "somewhere in this document there is a scheme of an unknown
 * type" is not an address.
 *
 * @param id - The id this scheme is filed under, declared or derived
 * @param source - The Security Scheme Object, resolved and untrusted
 * @param where - Where the document wrote it, in the document's own coordinates
 * @returns The scheme
 * @throws {NormalizeError} When the type is not one of the thirteen, or was not written at all
 */
function readAsyncApiSecurityScheme(
  id: string,
  source: Record<string, unknown>,
  where: string,
): IRSecurityScheme {
  const type = ASYNCAPI_SECURITY_SCHEME_TYPES.find((candidate) => candidate === source.type);
  if (type === undefined) {
    throw invalidDocument(
      `${where} declares the security scheme type ${JSON.stringify(source.type)}, and AsyncAPI 3 ` +
        `declares thirteen: ${ASYNCAPI_SECURITY_SCHEME_TYPES.join(', ')}`,
      { position: where, type: source.type },
    );
  }

  const scheme: Draft<IRSecurityScheme> = { id, type };

  const description = asString(source.description);
  if (description !== undefined) scheme.description = description;

  if (type === 'httpApiKey') {
    const name = asString(source.name);
    if (name !== undefined) scheme.name = name;
  }

  const locations = ASYNCAPI_KEY_LOCATIONS[type];
  if (locations !== undefined) {
    const location = locations.find((candidate) => candidate === source.in);
    if (location !== undefined) scheme.in = location;
  }

  if (type === 'http') {
    const httpScheme = asString(source.scheme);
    const bearerFormat = asString(source.bearerFormat);
    if (httpScheme !== undefined) scheme.scheme = httpScheme;
    if (bearerFormat !== undefined) scheme.bearerFormat = bearerFormat;
  }

  if (type === 'openIdConnect') {
    const url = asString(source.openIdConnectUrl);
    if (url !== undefined) scheme.openIdConnectUrl = url;
  }

  if (type === 'oauth2' && isPlainObject(source.flows)) {
    const flows: Draft<IROAuthFlows> = {};
    for (const name of ASYNCAPI_OAUTH_FLOWS) {
      const flow = readAsyncApiOAuthFlow(source.flows[name]);
      if (flow !== undefined) flows[name] = flow;
    }
    if (Object.keys(flows).length > 0) scheme.flows = flows;
  }

  return scheme;
}

/**
 * Reads `components.securitySchemes` into the document's own scheme table.
 *
 * IT IS READ WHOLE, INCLUDING SCHEMES NOTHING REFERS TO, which is what the OpenAPI side does with
 * the same block and for the same reason: the table is what the document declares it can be
 * called with, and a scheme nobody references yet is still declared.
 *
 * IT IS ALSO WHERE A `$ref` TO AN UNKNOWN TYPE IS REFUSED, because this block is read before the
 * servers and before the operations. The position a reader is sent to is therefore the declaration
 * rather than the reference, which is the position they would have to edit either way.
 *
 * @param context - The document being normalized, whose scheme table is filled in place
 * @param raw - The `securitySchemes` member of `components`, untrusted
 * @throws {NormalizeError} When a declared scheme's type is not one of the thirteen
 */
function readDeclaredSecuritySchemes(context: Context, raw: unknown): void {
  if (!isPlainObject(raw)) return;

  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const written = raw[name];
    const chain = referenceChain(context, written, `security scheme ${name}`);
    if (!isPlainObject(chain.value)) continue;

    const scheme = readAsyncApiSecurityScheme(
      name,
      chain.value,
      `components.securitySchemes.${name}`,
    );

    context.securitySchemes.set(name, scheme);
    context.securitySchemeNames.set(chain.value, name);
    // Second, so a `$ref` wrapper beats the definition it points at when two names share one,
    // which is the rule `positionOf` states and the servers block already applies.
    if (isPlainObject(written)) context.securitySchemeNames.set(written, name);
  }
}

/**
 * Files an inline Security Scheme Object under an id derived from where it was written.
 *
 * AN INLINE SCHEME HAS NO NAME, SO THE POSITION IS THE NAME. `<position>-security-<index>`, where
 * the index is the entry's place in the list exactly as the document wrote it, and a clash with a
 * declared name or with another derived id takes a numeric suffix in canonical order, which is the
 * resolution SPEC 8.2 already uses for two channels whose ids collide.
 *
 * @param context - The document being normalized, whose scheme table is filled in place
 * @param position - The server's name or the operation's key
 * @param index - The entry's place in the `security` list as written
 * @param source - The Security Scheme Object, resolved
 * @param where - The position in the document's own coordinates, for a refusal
 * @returns The id it was filed under
 * @throws {NormalizeError} When the type is not one of the thirteen
 */
function fileInlineSecurityScheme(
  context: Context,
  position: string,
  index: number,
  source: Record<string, unknown>,
  where: string,
): string {
  const derived = `${position}-security-${String(index)}`;
  let id = derived;
  let suffix = 2;
  while (context.securitySchemes.has(id)) {
    id = `${derived}-${String(suffix)}`;
    suffix += 1;
  }

  context.securitySchemes.set(id, readAsyncApiSecurityScheme(id, source, where));
  return id;
}

/**
 * Reads a `security` list of Server or Operation into requirements naming the document's table.
 *
 * REQUIREMENTS AND NOT COPIES OF THE SCHEMES, and SPEC 8.2 records why. AsyncAPI writes the whole
 * Security Scheme Object at each position, but the IR already has one place for a scheme and one
 * shape for "this position needs that scheme with these scopes"; copying the object into every
 * position would write one scheme into the document N+1 times and leave a reader unable to tell
 * one scheme used twice from two schemes that happen to match.
 *
 * `scopes` COMES FROM THE SCHEME OBJECT AT THE POSITION, because that is where AsyncAPI puts it:
 * "List of the needed scope names", on the Security Scheme Object, for `oauth2` and
 * `openIdConnect`. It is the same fact OpenAPI writes as the value of a Security Requirement.
 *
 * A WRITTEN EMPTY LIST IS CARRIED AS AN EMPTY LIST. Neither the Server Object nor the Operation
 * Object says what an empty `security` means, unlike the Channel Object's `servers`, so "said
 * there are none" is kept as what it is rather than merged into "said nothing".
 *
 * @param context - The document being normalized
 * @param raw - The `security` member, untrusted
 * @param position - The server's name or the operation's key, for the derived ids
 * @param block - The block this list is in, `servers` or `operations`, for a refusal
 * @returns The requirements, or nothing when the member was not written as a list
 * @throws {NormalizeError} When an inline scheme's type is not one of the thirteen
 */
function readSecurityDeclarations(
  context: Context,
  raw: unknown,
  position: string,
  block: 'servers' | 'operations',
): IRSecurityRequirement[] | undefined {
  if (!isUnknownArray(raw)) return undefined;

  const requirements: IRSecurityRequirement[] = [];

  for (const [index, entry] of raw.entries()) {
    const resolved = referenceChain(context, entry, `security ${String(index)} of ${position}`);
    if (!isPlainObject(resolved.value)) continue;

    const declared = positionOf(context.securitySchemeNames, resolved.chain);
    const schemeId =
      declared ??
      fileInlineSecurityScheme(
        context,
        position,
        index,
        resolved.value,
        `${block}.${position}.security[${String(index)}]`,
      );

    requirements.push({ schemeId, scopes: readStringList(resolved.value.scopes) ?? [] });
  }

  return requirements;
}

/** A channel as the document wrote it, with the identity this normalizer gave it. */
interface RawChannel {
  /** The key the document files the channel under. */
  readonly key: string;
  readonly source: Record<string, unknown>;
  /**
   * The member as written at this position, before any `$ref` was followed.
   *
   * It identifies the position where {@link RawChannel.source} identifies only the target, which
   * two positions may share. Absent when the document wrote something that is not an object.
   */
  readonly written: Record<string, unknown> | undefined;
  /** Node id, unique within the document. */
  readonly id: string;
  /** The channel's messages by the key its own `messages` map files them under. */
  readonly messages: readonly RawMessage[];
}

/** One message of a channel, as the document wrote it. */
interface RawMessage {
  readonly key: string;
  readonly source: Record<string, unknown>;
  /** The member as written at this position. See {@link RawChannel.written}. */
  readonly written: Record<string, unknown> | undefined;
}

/**
 * Reads a channel's own `messages` map, in code point order of its keys.
 *
 * The key is the message id in the IR, and it is the key rather than the message's `name`
 * because that is what an operation refers to: `#/channels/<channel>/messages/<key>`.
 *
 * @param context - The document being normalized
 * @param source - The channel object
 * @param key - The channel's key, for the message a reader gets
 * @returns The messages, in canonical order
 */
function collectMessages(
  context: Context,
  source: Record<string, unknown>,
  key: string,
): RawMessage[] {
  const raw = source.messages;
  if (!isPlainObject(raw)) return [];

  const messages: RawMessage[] = [];
  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const written = raw[name];
    const resolved = followReference(context, written, `message ${name} of channel ${key}`);
    if (!isPlainObject(resolved)) continue;
    messages.push({
      key: name,
      source: resolved,
      written: isPlainObject(written) ? written : undefined,
    });
  }

  return messages;
}

/**
 * Reads the Correlation ID Object down to the one thing the IR holds.
 *
 * `IRMessage.correlationId` IS THE RUNTIME EXPRESSION AND NOT THE OBJECT. AsyncAPI writes
 * `{ location, description }`, and `location` is the whole of the fact: it says where in the
 * message the value that ties a request to its reply is found. The description is prose about
 * that expression and the IR has nowhere to put it, so it is left rather than folded into a
 * field that means something else.
 *
 * @param context - The document being normalized
 * @param raw - The `correlationId` member, untrusted
 * @param where - What is being read, for the message a reader gets
 * @returns The runtime expression, or nothing when the document wrote none
 */
function readCorrelationId(context: Context, raw: unknown, where: string): string | undefined {
  if (raw === undefined) return undefined;

  const source = followReference(context, raw, where);
  if (!isPlainObject(source)) return undefined;

  return asString(source.location);
}

/**
 * Reads a message's examples, which AsyncAPI writes as a list rather than as a map.
 *
 * THE VALUE IS THE MESSAGE AND NOT ONLY ITS PAYLOAD. An AsyncAPI example carries `headers` and
 * `payload`, and {@link IRExample.value} is one value, so taking the payload alone would drop the
 * headers of every example that has them without saying so. The value is therefore an object
 * carrying whichever of the two the document wrote, under those names, which is the same shape
 * for every example and so is something a renderer can draw one way.
 *
 * @param raw - The `examples` member of a message, untrusted
 * @returns The examples keyed by their declared name, or by position when they declare none
 */
function readMessageExamples(raw: unknown): Record<string, IRExample> | undefined {
  if (!isUnknownArray(raw)) return undefined;

  const examples: Record<string, IRExample> = {};
  for (const [index, entry] of raw.entries()) {
    if (!isPlainObject(entry)) continue;

    const position = `example-${String(index + 1)}`;
    const declared = asString(entry.name) ?? position;
    // Two examples may carry one name, and the second must not replace the first in silence.
    const key = Object.hasOwn(examples, declared) ? `${declared}-${position}` : declared;

    const example: Draft<IRExample> = {};
    const summary = asString(entry.summary);
    if (summary !== undefined) example.summary = summary;

    const value: Record<string, IRJsonValue> = {};
    const headers = asJsonValue(entry.headers);
    const payload = asJsonValue(entry.payload);
    if (headers !== undefined) value.headers = headers;
    if (payload !== undefined) value.payload = payload;
    if (Object.keys(value).length > 0) example.value = value;

    examples[key] = example;
  }

  return Object.keys(examples).length > 0 ? examples : undefined;
}

/**
 * Builds one message of a channel.
 *
 * `payload` AND `headers` BOTH GO THROUGH THE MULTI FORMAT SCHEMA OBJECT PATH OF SPEC 5.2, which
 * is `T005`'s and is shared with everything else that reads a schema. A JSON Schema compatible
 * payload takes the common pipeline and fills `normalized`; Avro, Protobuf and a format this
 * version does not know keep `raw` with the `schemaFormat` string inside it, so the renderer can
 * show annotated source and name the language.
 *
 * @param context - The document being normalized
 * @param entry - The message, resolved
 * @param channelId - Node id of the channel it belongs to, for the inline schema ids
 * @returns The message
 */
function readMessage(context: Context, entry: RawMessage, channelId: string): IRMessage {
  const { key } = entry;
  const source = applyTraits(context, entry.source, `message ${key}`);
  const message: Draft<IRMessage> = { id: key };

  const name = asString(source.name);
  const title = asString(source.title);
  const summary = asString(source.summary);
  const description = asString(source.description);
  // A message that names no content type takes the document's `defaultContentType`, which is
  // what that field is for. Leaving it empty would report a message as untyped on a document
  // that typed all of them in one place.
  const contentType = asString(source.contentType) ?? context.defaultContentType;
  if (name !== undefined) message.name = name;
  if (title !== undefined) message.title = title;
  if (summary !== undefined) message.summary = summary;
  if (description !== undefined) message.description = description;
  if (contentType !== undefined) message.contentType = contentType;

  const payload = schemaSlot(source.payload, context, `${channelId}.messages.${key}.payload`);
  const headers = schemaSlot(source.headers, context, `${channelId}.messages.${key}.headers`);
  if (payload !== undefined) message.payload = payload;
  if (headers !== undefined) message.headers = headers;

  const correlationId = readCorrelationId(
    context,
    source.correlationId,
    `the correlationId of message ${key}`,
  );
  if (correlationId !== undefined) message.correlationId = correlationId;

  const bindings = readBindings(source.bindings);
  const examples = readMessageExamples(source.examples);
  const tags = readTagNames(source.tags);
  if (bindings !== undefined) message.bindings = bindings;
  if (examples !== undefined) message.examples = examples;
  if (tags.length > 0) message.tags = tags;

  return message;
}

/**
 * The IR override that names one server, description and all.
 *
 * @param server - The server as the document declared it
 * @returns The override a node carries for it
 */
function serverOverride(server: IRServer): IRServerOverride {
  const override: Draft<IRServerOverride> = { url: server.url };
  if (server.description !== undefined) override.description = server.description;
  return override;
}

/**
 * Builds the servers a channel is bound to, both as IR overrides and as the servers themselves.
 *
 * ABSENT AND EMPTY BOTH MEAN EVERY SERVER, WHICH IS ASYNCAPI'S OWN SENTENCE AND NOT A CHOICE MADE
 * HERE. The Channel Object's `servers` field, in `spec/asyncapi.md` of `asyncapi/spec` at both
 * `v3.0.0` and `v3.1.0`, word for word: "If `servers` is absent or empty, this channel MUST be
 * available on all the servers defined in the Servers Object". The OpenAPI side keeps "said
 * nothing" apart from "said none" for an operation's `security`, and SPEC 8.2 used to carry that
 * distinction over to here, which was reading one specification by the other one's rule.
 *
 * SO THE LIST IS RESOLVED RATHER THAN LEFT EMPTY. A reader of `IRChannel.servers` alone gets the
 * servers the channel is on, in the canonical order `IRDocument.servers` keeps, instead of an
 * empty array that says "on no server" about a channel that is on all of them.
 *
 * @param context - The document being normalized
 * @param source - The channel object
 * @param key - The channel's key, for the message a reader gets
 * @returns The overrides for the IR, and the servers they name
 * @throws {RefResolutionError} When a reference names no server the document declares
 */
function readChannelServers(
  context: Context,
  source: Record<string, unknown>,
  key: string,
): { readonly overrides: IRServerOverride[]; readonly bound: IRServer[] } {
  const raw = Object.hasOwn(source, 'servers') ? source.servers : undefined;

  // A member written as something other than an array is read as one that was not written, the
  // way every other member of the wrong shape is skipped here, so it lands on the same default.
  if (!isUnknownArray(raw) || raw.length === 0) {
    const every = [...context.servers.values()];
    return { overrides: every.map(serverOverride), bound: every };
  }

  const overrides: IRServerOverride[] = [];
  const bound: IRServer[] = [];

  for (const [index, entry] of raw.entries()) {
    const where = `server ${String(index)} of channel ${key}`;
    const resolved = referenceChain(context, entry, where);
    if (!isPlainObject(resolved.value)) continue;

    const name = positionOf(context.serverNames, resolved.chain);
    const server = name === undefined ? undefined : context.servers.get(name);
    if (server === undefined) {
      throw new RefResolutionError(
        `${where} names no server this document declares under servers`,
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { channel: key, index },
      );
    }

    overrides.push(serverOverride(server));
    bound.push(server);
  }

  return { overrides, bound };
}

/**
 * Reads the `parameters` block of a channel, which is what makes a templated address readable.
 *
 * THE FIVE MEMBERS ARE THE PARAMETER OBJECT'S OWN and none of them is required. `spec/asyncapi.md`
 * of `asyncapi/spec`, at both `v3.0.0` and `v3.1.0`, declares `enum`, `default`, `description`,
 * `examples` and `location` and marks no member required, so a parameter that writes nothing still
 * says the variable exists and is carried as the empty record rather than dropped.
 *
 * THE VALUE MAY BE A REFERENCE OBJECT, which the specification's own field pattern says, so each
 * entry goes through {@link followReference} the way every other structural member here does, and
 * stays inside its document for the reason that function gives.
 *
 * @param context - The document being normalized
 * @param raw - The `parameters` member, untrusted
 * @param key - The channel's key, for the message a reader gets
 * @returns The parameters by declared name, in code point order, or nothing when there are none
 * @throws {RefResolutionError} When a reference leaves the document or resolves to nothing
 */
function readChannelParameters(
  context: Context,
  raw: unknown,
  key: string,
): Record<string, IRChannelParameter> | undefined {
  if (!isPlainObject(raw)) return undefined;

  const parameters: Record<string, IRChannelParameter> = {};
  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const source = followReference(context, raw[name], `parameter ${name} of channel ${key}`);
    if (!isPlainObject(source)) continue;

    const parameter: Draft<IRChannelParameter> = {};
    const values = readStringList(source.enum);
    const fallback = asString(source.default);
    const description = asString(source.description);
    const examples = readStringList(source.examples);
    const location = asString(source.location);

    if (values !== undefined) parameter.enum = values;
    if (fallback !== undefined) parameter.default = fallback;
    if (description !== undefined) parameter.description = description;
    if (examples !== undefined) parameter.examples = examples;
    if (location !== undefined) parameter.location = location;

    parameters[name] = parameter;
  }

  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

/**
 * The strings of a `[string]` member, in the order the document wrote them.
 *
 * ORDER IS THE DOCUMENT'S HERE AND NOT CANONICAL, unlike the keys of every map this reads. `enum`
 * and `examples` are sequences a document authored, and sorting them would be presenting a
 * different document; the ordering rule of SPEC 5.3 is about spellings a parser hands back in an
 * order nobody chose, which an array is not. An entry that is not a string is skipped, the way
 * every member of the wrong shape is skipped here.
 *
 * @param raw - The member, untrusted
 * @returns The strings, or nothing when there are none
 */
function readStringList(raw: unknown): string[] | undefined {
  if (!isUnknownArray(raw)) return undefined;

  const values: string[] = [];
  for (const entry of raw) {
    const value = asString(entry);
    if (value !== undefined) values.push(value);
  }

  return values.length > 0 ? values : undefined;
}

/**
 * The one protocol a channel speaks, when the document leaves no doubt about which it is.
 *
 * AsyncAPI puts the protocol on the server rather than on the channel, and a channel is bound to
 * a set of servers. So the protocol of a channel is the protocol of its servers when they agree,
 * and nothing when they do not: a topic offered over both `kafka` and `ws` has two protocols, and
 * naming one of them would be this normalizer choosing on the document's behalf.
 *
 * @param bound - The servers the channel is available on
 * @returns The protocol they agree on, or nothing
 */
function channelProtocol(bound: readonly IRServer[]): string | undefined {
  const protocols = new Set<string>();
  for (const server of bound) {
    if (server.protocol !== undefined) protocols.add(server.protocol);
  }

  return protocols.size === 1 ? [...protocols][0] : undefined;
}

/**
 * Collects every channel, resolved, in code point order of its key, with a node id each.
 *
 * THE ID IS DERIVED FROM THE ADDRESS AND NOT FROM THE KEY WHEN THERE IS ONE, because the address
 * is what a reader sees and what a deep link should say. A channel with no address, which
 * AsyncAPI permits for one whose address is decided at runtime, falls back to its key, since a
 * node still needs a permalink. A clash between two derived ids takes a numeric suffix in
 * canonical order, the same resolution operation identity uses.
 *
 * @param context - The document being normalized
 * @param raw - The `channels` member, untrusted
 * @returns The channels, in canonical order
 */
function collectChannels(context: Context, raw: unknown): RawChannel[] {
  if (!isPlainObject(raw)) return [];

  const channels: RawChannel[] = [];
  const taken = new Set<string>();

  for (const key of Object.keys(raw).sort(compareByCodePoint)) {
    const written = raw[key];
    const source = followReference(context, written, `channel ${key}`);
    if (!isPlainObject(source)) continue;

    const derived = `${CHANNEL_ID_PREFIX}${pathSlug(asString(source.address) ?? key)}`;
    let id = derived;
    let suffix = 2;
    while (taken.has(id)) {
      id = `${derived}-${String(suffix)}`;
      suffix += 1;
    }
    taken.add(id);

    channels.push({
      key,
      source,
      written: isPlainObject(written) ? written : undefined,
      id,
      messages: collectMessages(context, source, key),
    });
  }

  return channels;
}

/** Where a message lives: the channel's key, and its key inside that channel. */
interface MessagePosition {
  readonly channel: string;
  readonly message: string;
}

/** Every object that identifies a channel position or a message position, and which one. */
interface Positions {
  readonly channelKeys: ReadonlyMap<object, string>;
  readonly messageKeys: ReadonlyMap<object, MessagePosition>;
}

/**
 * Indexes every channel and message by both the object written at its position and the object that
 * position resolves to.
 *
 * THE WRITTEN LINK IS REGISTERED SECOND, SO IT WINS. A target may be shared between positions and a
 * written `$ref` wrapper may not, so where the two disagree the wrapper is the one that answers.
 * The target stays in the map because a document may name a channel's only message through the
 * Components Object directly, and dropping the entry would refuse a document that resolves.
 *
 * @param channels - The channels, already collected
 * @returns The two maps {@link positionOf} is read against
 */
function positionsOf(channels: readonly RawChannel[]): Positions {
  const channelKeys = new Map<object, string>();
  const messageKeys = new Map<object, MessagePosition>();

  for (const channel of channels) {
    channelKeys.set(channel.source, channel.key);
    for (const message of channel.messages) {
      messageKeys.set(message.source, { channel: channel.key, message: message.key });
    }
  }

  for (const channel of channels) {
    if (channel.written !== undefined) channelKeys.set(channel.written, channel.key);
    for (const message of channel.messages) {
      if (message.written === undefined) continue;
      messageKeys.set(message.written, { channel: channel.key, message: message.key });
    }
  }

  return { channelKeys, messageKeys };
}

/**
 * Reads the root `operations` block and files each operation under the channel it names.
 *
 * FAIL CLOSED ON BOTH REQUIRED MEMBERS. `action` has two legal values and `channel` has to point
 * at a channel this document lists, so an operation missing either is not a malformed optional
 * member to skip past: it is an operation that would leave the reference with nothing anywhere
 * recording that the document had it. The channel is matched by the nearest link of the reference
 * chain that names a position, per {@link positionOf}, so a document that reaches its channel
 * through `#/components/channels/...` is read correctly as long as the root `channels` block names
 * the same object, and two root channels sharing one definition still answer for themselves.
 *
 * @param context - The document being normalized
 * @param raw - The `operations` member, untrusted
 * @param channels - The channels, already collected
 * @returns The operations of each channel, keyed by the channel's key
 * @throws {NormalizeError} When an operation declares no readable action
 * @throws {RefResolutionError} When an operation names a channel or a message that is not there
 */
function collectChannelOperations(
  context: Context,
  raw: unknown,
  channels: readonly RawChannel[],
): Map<string, IRChannelOperation[]> {
  const byChannel = new Map<string, IRChannelOperation[]>();
  for (const channel of channels) byChannel.set(channel.key, []);

  if (!isPlainObject(raw)) return byChannel;

  const positions = positionsOf(channels);
  const { channelKeys, messageKeys } = positions;

  for (const key of Object.keys(raw).sort(compareByCodePoint)) {
    const resolved = followReference(context, raw[key], `operation ${key}`);
    if (!isPlainObject(resolved)) continue;
    const source = applyTraits(context, resolved, `operation ${key}`);

    const action = asString(source.action);
    if (action !== 'send' && action !== 'receive') {
      throw invalidDocument(
        `operation ${key} declares the action ${JSON.stringify(source.action)}, and an ` +
          'AsyncAPI operation is either send or receive',
        { operation: key, action: source.action },
      );
    }

    const target = referenceChain(context, source.channel, `the channel of operation ${key}`);
    const channelKey = positionOf(channelKeys, target.chain);
    if (channelKey === undefined) {
      throw new RefResolutionError(
        `operation ${key} names no channel this document lists under channels`,
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { operation: key },
      );
    }

    const channel = channels.find((candidate) => candidate.key === channelKey);
    const operation: Draft<IRChannelOperation> = {
      id: key,
      direction: action satisfies IRChannelDirection,
      messageIds: readOperationMessageIds(
        context,
        source.messages,
        key,
        channelKey,
        channel?.messages ?? [],
        messageKeys,
      ),
    };

    const summary = asString(source.summary);
    const description = asString(source.description);
    const bindings = readBindings(source.bindings);
    const reply = readOperationReply(context, source.reply, key, channels, positions);
    const tags = readTagNames(source.tags);
    const security = readSecurityDeclarations(context, source.security, key, 'operations');
    if (summary !== undefined) operation.summary = summary;
    if (description !== undefined) operation.description = description;
    if (bindings !== undefined) operation.bindings = bindings;
    if (reply !== undefined) operation.reply = reply;
    if (tags.length > 0) operation.tags = tags;
    if (security !== undefined) operation.security = security;

    byChannel.get(channelKey)?.push(operation);
  }

  return byChannel;
}

/**
 * Reads the Operation Reply Object, which is the other half of a request-reply pair.
 *
 * THE CARRIER EXISTS BECAUSE THE CORPUS WRITES IT, per SPEC 8.2 and the maintainer's ruling of
 * 2026-08-29: 13 positions across four of the 23 event corpus documents, the most written of the
 * six members `T048` had nowhere to put.
 *
 * FAIL CLOSED ON A REPLY THAT POINTS NOWHERE, by the rule the operation's own channel already
 * follows. A reply naming a channel this document does not list, or a message that is not of the
 * channel the reply names, is half a request-reply pair with the other half missing, and carrying
 * it would print a page whose reply link resolves to nothing.
 *
 * AN EMPTY REPLY IS CARRIED AS THE EMPTY RECORD. `reply: {}` says the operation is one half of a
 * request-reply pair, which is a fact that an operation with no `reply` at all does not carry.
 *
 * @param context - The document being normalized
 * @param raw - The operation's `reply` member, untrusted
 * @param key - The operation's key, for the message a reader gets
 * @param channels - The channels, already collected, for the reply channel's node id
 * @param positions - Every object that names a channel position or a message position
 * @returns The reply, or nothing when the operation wrote none
 * @throws {RefResolutionError} When the reply names a channel or a message that is not there
 */
function readOperationReply(
  context: Context,
  raw: unknown,
  key: string,
  channels: readonly RawChannel[],
  positions: Positions,
): IRChannelReply | undefined {
  const source = followReference(context, raw, `the reply of operation ${key}`);
  if (!isPlainObject(source)) return undefined;

  const reply: Draft<IRChannelReply> = {};
  let replyChannel: RawChannel | undefined;

  if (source.channel !== undefined) {
    const where = `the reply channel of operation ${key}`;
    const channelKey = positionOf(
      positions.channelKeys,
      referenceChain(context, source.channel, where).chain,
    );
    if (channelKey === undefined) {
      throw new RefResolutionError(
        `${where} names no channel this document lists under channels`,
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { operation: key },
      );
    }
    replyChannel = channels.find((candidate) => candidate.key === channelKey);
    if (replyChannel !== undefined) reply.channelId = replyChannel.id;
  }

  if (isUnknownArray(source.messages)) {
    reply.messageIds = readReplyMessageIds(context, source.messages, key, replyChannel, positions);
    if (reply.messageIds.length === 0) delete reply.messageIds;
  }

  const address = followReference(context, source.address, `the reply address of operation ${key}`);
  if (isPlainObject(address)) {
    const location = asString(address.location);
    if (location !== undefined) reply.address = location;
  }

  return reply;
}

/**
 * The messages a reply carries, as ids local to the reply's own channel.
 *
 * @param context - The document being normalized
 * @param raw - The reply's `messages` member, known to be an array
 * @param key - The operation's key, for the message a reader gets
 * @param replyChannel - The channel the reply names, absent when it named none
 * @param positions - Every object that names a message position
 * @returns The message ids, in the order the reply wrote them
 * @throws {RefResolutionError} When the reply names messages but no channel, or a foreign message
 */
function readReplyMessageIds(
  context: Context,
  raw: readonly unknown[],
  key: string,
  replyChannel: RawChannel | undefined,
  positions: Positions,
): string[] {
  if (replyChannel === undefined) {
    throw new RefResolutionError(
      `the reply of operation ${key} names messages but no channel, and a reply message is a ` +
        'local name inside the channel the reply is on',
      ErrorCode.NORM_REF_UNRESOLVED,
      undefined,
      { operation: key },
    );
  }

  const ids: string[] = [];
  for (const [index, entry] of raw.entries()) {
    const where = `reply message ${String(index)} of operation ${key}`;
    const found = positionOf(positions.messageKeys, referenceChain(context, entry, where).chain);

    if (found?.channel !== replyChannel.key) {
      throw new RefResolutionError(
        `${where} names no message of channel ${replyChannel.key}`,
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { operation: key, channel: replyChannel.key, index },
      );
    }

    if (!ids.includes(found.message)) ids.push(found.message);
  }

  return ids;
}

/**
 * The messages one operation carries, as ids into its own channel's message list.
 *
 * AN OPERATION THAT NAMES NO MESSAGE CARRIES ALL OF THEM, which is AsyncAPI's own default and is
 * a reading of the document rather than a guess about it. One that names messages must name
 * messages of its own channel: a reference into another channel's list would produce an id that
 * resolves to nothing, since `messageIds` are local names inside the channel that holds them.
 *
 * @param context - The document being normalized
 * @param raw - The operation's `messages` member, untrusted
 * @param key - The operation's key, for the message a reader gets
 * @param channelKey - Key of the channel the operation is on
 * @param messages - That channel's messages
 * @param messageKeys - Every message of every channel, by every object that names its position
 * @returns The message ids, in the order the operation wrote them
 * @throws {RefResolutionError} When a reference names no message of that channel
 */
function readOperationMessageIds(
  context: Context,
  raw: unknown,
  key: string,
  channelKey: string,
  messages: readonly RawMessage[],
  messageKeys: ReadonlyMap<object, MessagePosition>,
): string[] {
  if (!isUnknownArray(raw)) return messages.map((message) => message.key);

  const ids: string[] = [];
  for (const [index, entry] of raw.entries()) {
    const where = `message ${String(index)} of operation ${key}`;
    const found = positionOf(messageKeys, referenceChain(context, entry, where).chain);

    if (found?.channel !== channelKey) {
      throw new RefResolutionError(
        `${where} names no message of channel ${channelKey}`,
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { operation: key, channel: channelKey, index },
      );
    }

    if (!ids.includes(found.message)) ids.push(found.message);
  }

  return ids;
}

/**
 * Builds the topology edges an event document declares, per SPEC 9.3.
 *
 * WHAT THE DOCUMENT SAYS AND WHAT IT DOES NOT. An AsyncAPI document describes one application.
 * `action: send` says that application writes to the channel and `action: receive` says it reads
 * from it, so each operation is one edge between the application and the channel, drawn in the
 * direction the message travels per SPEC 9.2. Who else reads the channel is not in this document,
 * and no edge is invented for it: a subscriber appears when its own document is federated in.
 *
 * THE APPLICATION IS NAMED BY THE DOCUMENT ID HERE AND BY THE SERVICE ID AFTER A MERGE. The merge
 * in `@openref/federation` rewrites a `service` end that matches the source document's id, which
 * is the one place that knows both names.
 *
 * `reply` GIVES ONE EDGE AND NOT TWO. The Operation Reply Object says where the reply travels, so
 * the request channel calling the reply channel is written down. What is deliberately not written
 * down is "the application also listens on the reply channel": AsyncAPI states a reply on the
 * Operation Object rather than as a second operation with its own `action`, so deriving a second
 * direction from it would be a reading of the application rather than of the document.
 *
 * @param channels - Every channel node of the document
 * @param serviceName - What names this application, per SPEC 9.1
 * @returns The edges, folded and ordered
 */
function eventRelationships(channels: readonly IRChannel[], serviceName: string): IRRelationship[] {
  const edges: IRRelationship[] = [];

  for (const channel of channels)
    for (const operation of channel.operations) {
      edges.push(
        operation.direction === 'send'
          ? {
              from: serviceName,
              fromKind: 'service',
              to: channel.id,
              toKind: 'node',
              type: 'publishes',
              confidence: 'declared',
            }
          : {
              from: channel.id,
              fromKind: 'node',
              to: serviceName,
              toKind: 'service',
              type: 'subscribes',
              confidence: 'declared',
            },
      );

      const replyChannel = operation.reply?.channelId;
      if (replyChannel !== undefined)
        edges.push({
          from: channel.id,
          fromKind: 'node',
          to: replyChannel,
          toKind: 'node',
          type: 'calls',
          confidence: 'declared',
        });
    }

  return orderRelationships(edges);
}

/**
 * Builds one channel node.
 *
 * @param context - The document being normalized
 * @param channel - The channel as written, with its id
 * @param operations - The operations that named it, in canonical order
 * @returns The channel node
 */
function readChannel(
  context: Context,
  channel: RawChannel,
  operations: readonly IRChannelOperation[],
): IRChannel {
  const { source, key, id } = channel;
  const { overrides, bound } = readChannelServers(context, source, key);

  const node: Draft<IRChannel> = {
    kind: 'channel',
    id,
    tags: readTagNames(source.tags),
    // AsyncAPI declares no `deprecated` on a channel, at any version this reads. The field is
    // required by the IR because an HTTP operation always answers it, so the honest answer here
    // is the one the document gives, which is that it says nothing.
    deprecated: false,
    servers: overrides,
    operations: [...operations],
    messages: channel.messages.map((message) => readMessage(context, message, id)),
  };

  const address = asString(source.address);
  const title = asString(source.title);
  const summary = asString(source.summary);
  const description = asString(source.description);
  const protocol = channelProtocol(bound);
  const parameters = readChannelParameters(context, source.parameters, key);
  const bindings = readBindings(source.bindings);
  const extensions = readExtensions(source);

  if (address !== undefined) node.address = address;
  if (title !== undefined) node.title = title;
  if (summary !== undefined) node.summary = summary;
  if (description !== undefined) node.description = description;
  if (protocol !== undefined) node.protocol = protocol;
  if (parameters !== undefined) node.parameters = parameters;
  if (bindings !== undefined) node.bindings = bindings;
  if (extensions !== undefined) node.extensions = extensions;

  return node;
}

/**
 * Splits `components.schemas` into the entries the shared pipeline can make and the rest.
 *
 * AN ENTRY CARRYING `schemaFormat` IS A MULTI FORMAT SCHEMA OBJECT AND NOT A JSON SCHEMA, so it
 * cannot go through the registry: `{ schemaFormat, schema }` normalized as a schema would produce
 * a body with two keywords JSON Schema has never heard of. Both halves of SPEC 5.2 are honoured
 * here instead. A JSON Schema compatible format has its inner `schema` normalized under the
 * declared name; Avro, Protobuf and a format this version does not recognise keep the whole
 * object in `raw` with the `schemaFormat` string inside it, which is what lets the renderer show
 * annotated source and say which language it is.
 *
 * @param context - The document being normalized
 * @returns The names to produce through the registry, and the schemas built here
 */
function readDeclaredSchemas(context: Context): {
  readonly plain: string[];
  readonly multiFormat: IRSchema[];
} {
  const components = context.document.components;
  const declared = isPlainObject(components) ? components.schemas : undefined;
  if (!isPlainObject(declared)) return { plain: [], multiFormat: [] };

  const plain: string[] = [];
  const multiFormat: IRSchema[] = [];

  for (const name of Object.keys(declared).sort(compareByCodePoint)) {
    const source = declared[name];
    if (!isPlainObject(source) || !('schemaFormat' in source)) {
      plain.push(name);
      continue;
    }

    const dialect = dialectFromSchemaFormat(source.schemaFormat);
    if (!isJsonSchemaCompatible(dialect)) {
      multiFormat.push({ id: name, name, dialect, raw: source });
      continue;
    }

    multiFormat.push({
      id: name,
      name,
      dialect,
      normalized: normalizeSchema(source.schema, schemaOptions(context)),
    });
  }

  return { plain, multiFormat };
}

/**
 * Reads and checks the `asyncapi` version field.
 *
 * @param document - The document, untrusted
 * @returns The major and minor version, for example `3.1`
 * @throws {NormalizeError} When the field is missing
 * @throws {UnsupportedDialectError} For a version outside 3.0 and 3.1
 */
function readVersion(document: Record<string, unknown>): string {
  const version = asString(document.asyncapi);
  if (version === undefined) {
    throw invalidDocument('the document has no asyncapi version field');
  }

  const majorMinor = version.split('.').slice(0, 2).join('.');
  if (SUPPORTED_ASYNCAPI_MAJOR_MINOR.includes(majorMinor)) return majorMinor;

  const major = Number.parseInt(version, 10);
  const legacy =
    Number.isInteger(major) && major < 3
      ? '; convert the document to AsyncAPI 3.x first'
      : `; supported versions are ${SUPPORTED_ASYNCAPI_MAJOR_MINOR.join(', ')}`;

  throw new UnsupportedDialectError(
    `AsyncAPI ${version} is not supported${legacy}`,
    ErrorCode.NORM_UNSUPPORTED_DIALECT,
    undefined,
    { version },
  );
}

/**
 * Normalizes an AsyncAPI 3.0 or 3.1 document into the intermediate representation.
 *
 * `relationships` IS NO LONGER EMPTY, SINCE `T052`. It was, from `T048` until 2026-08-29, because
 * SPEC 9 belonged to that task. What is read is what the document declares and nothing else, per
 * SPEC 9.3: `send` and `receive` give the application's own edge with the channel, `reply.channel`
 * gives the request channel calling the reply channel, and who else consumes a channel is not in
 * this document and gets no edge.
 *
 * `security` IS NO LONGER EMPTY, SINCE `T051`. It was, from `T048` until 2026-08-29, because
 * AsyncAPI declares thirteen kinds of security scheme where {@link IRSecuritySchemeType} had the
 * five OpenAPI names, and reading the overlap would have put a partial security picture on a page
 * where partial is worse than absent. The maintainer's ruling grew the union instead, so the
 * thirteen are read whole: the document's own `components.securitySchemes` become the table, and
 * a server's or an operation's `security` becomes requirements naming it.
 *
 * @param input - Parsed document, untrusted
 * @param options - Document id, external documents and nesting depth
 * @returns The document, fully resolved, ordered canonically and hashed
 * @throws {UnsupportedDialectError} For an AsyncAPI version outside 3.0 and 3.1, and for a
 *         `schemaFormat` that names no schema language at all
 * @throws {NormalizeError} When the document is malformed
 *
 * @example
 * const ir = normalizeAsyncApiDocument(parseSpecification(text));
 */
export function normalizeAsyncApiDocument(
  input: unknown,
  options: NormalizeAsyncApiOptions = {},
): IRDocument {
  if (!isPlainObject(input)) throw invalidDocument('the document is not an object');

  readVersion(input);

  const components = isPlainObject(input.components) ? input.components : undefined;
  const servers = new Map<string, IRServer>();
  const serverNames = new Map<object, string>();

  const context: Context = {
    document: input,
    // The default schema language of AsyncAPI 3, which is JSON Schema compatible and so takes
    // the shared pipeline. A payload that declares a `schemaFormat` overrides this per SPEC 5.2.
    dialect: 'asyncapi-schema',
    namedSchemas: new Set(
      components !== undefined && isPlainObject(components.schemas)
        ? Object.keys(components.schemas)
        : [],
    ),
    externalDocuments: options.externalDocuments ?? {},
    cycleDepth: options.cycleDepth,
    registry: createSchemaRegistry(),
    readerProblems: [],
    servers,
    serverNames,
    defaultContentType: asString(input.defaultContentType),
    securitySchemes: new Map<string, IRSecurityScheme>(),
    securitySchemeNames: new Map<object, string>(),
  };

  const info = readInfo(input.info);

  const declared = readDeclaredSchemas(context);
  produceDeclaredSchemas(context, declared.plain);

  // BEFORE THE SERVERS, BECAUSE A SERVER'S `security` NAMES THIS TABLE. A `$ref` at a server
  // position is matched against the objects filled in here, so reading the declarations later
  // would file every referenced scheme a second time under a derived id.
  readDeclaredSecuritySchemes(context, components?.securitySchemes);

  // The server map is filled in place, because a channel resolves a reference to a server and
  // has to find the entry this walk produced, and both are members of one context.
  const rawServers = isPlainObject(input.servers) ? input.servers : undefined;
  const writtenServers: [Record<string, unknown>, string][] = [];
  for (const [name, server] of readAsyncApiServers(context, input.servers)) {
    servers.set(name, server);
    if (rawServers === undefined) continue;

    const written = rawServers[name];
    const chain = referenceChain(context, written, `server ${name}`);
    if (isPlainObject(chain.value)) serverNames.set(chain.value, name);
    if (isPlainObject(written)) writtenServers.push([written, name]);
  }
  // Second, so that a `$ref` wrapper beats the definition it points at when two names share one.
  // The reason is {@link positionOf}'s, and the servers block asks the same question the channels
  // block does: which name was written here, not which object does this name end at.
  for (const [written, name] of writtenServers) serverNames.set(written, name);

  const rawChannels = collectChannels(context, input.channels);
  const operations = collectChannelOperations(context, input.operations, rawChannels);

  const channels = rawChannels.map((channel) =>
    readChannel(context, channel, operations.get(channel.key) ?? []),
  );

  const byId = new Map<string, IRSchema>();
  for (const schema of collectNamedSchemas(context)) byId.set(schema.id, schema);
  // A multi format declaration wins its own name. A JSON schema elsewhere in the document may
  // have referred to it and left a normalized body under the same id, and of the two readings the
  // one the declaration itself states is the correct one.
  for (const schema of declared.multiFormat) byId.set(schema.id, schema);
  const schemas = [...byId.values()].sort((left, right) => compareByCodePoint(left.id, right.id));

  const nodes = new Map<string, IRNode>(channels.map((channel) => [channel.id, channel]));
  const documentId = options.documentId ?? documentSlug(info.title);

  const document: Draft<IRDocument> = {
    id: documentId,
    kind: 'events',
    hash: '',
    info,
    // NO DEFAULT SERVER, WHICH IS THE OPPOSITE OF THE OPENAPI SIDE. OpenAPI declares that a
    // document with no `servers` has one server at `/`, meaning wherever the document is served
    // from. AsyncAPI declares no such default, and inventing one would put an HTTP relative
    // address in the broker list of a document that named no broker.
    servers: [...servers.values()],
    navigation: buildNavigation({
      tags: readTags(readInfoTags(input.info)),
      nodes: channels,
      schemas,
    }),
    nodes,
    schemas: new Map(schemas.map((schema) => [schema.id, schema])),
    // SORTED BY ID RATHER THAN BY INSERTION, per SPEC 5.3. The declared names arrive in code point
    // order and the derived ids arrive in the order the servers and operations were walked, and
    // one list built from two walks has no meaningful order until it is given one.
    security: [...context.securitySchemes.values()].sort((left, right) =>
      compareByCodePoint(left.id, right.id),
    ),
    relationships: eventRelationships(channels, documentId),
    webhooks: new Map<string, IRNode>(),
  };

  const extensions = readExtensions(input);
  if (extensions !== undefined) document.extensions = extensions;
  if (context.readerProblems.length > 0) document.readerProblems = context.readerProblems;

  return finalizeDocument(document);
}

/**
 * The document level tag list, which AsyncAPI 3 writes under `info` rather than at the root.
 *
 * @param info - The `info` member, untrusted
 * @returns The `tags` member, or nothing
 */
function readInfoTags(info: unknown): unknown {
  return isPlainObject(info) ? info.tags : undefined;
}

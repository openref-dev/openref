import { finalizeDocument } from '../../hashing/domain/hash';
import type {
  IRDocument,
  IRUnreadKey,
  IROAuthFlow,
  IROAuthFlows,
  IRSecurityScheme,
  IRSecuritySchemeType,
  IRServer,
  IRUnreadKeyPosition,
} from '../../ir/domain/document.types';
import type {
  IRCodeSample,
  IREncoding,
  IRExample,
  IRHeader,
  IRMediaType,
  IRNode,
  IROperation,
  IRParameter,
  IRParameterLocation,
  IRParameterStyle,
  IRRequestBody,
  IRResponse,
  IRSecurityRequirement,
  IRServerOverride,
} from '../../ir/domain/node.types';
import { ErrorCode } from '../../shared/errors/codes';
import { RefResolutionError, UnsupportedDialectError } from '../../shared/errors/index';
import {
  collectNamedSchemas,
  documentSlug,
  invalidDocument,
  produceDeclaredSchemas,
  readExtensions,
  readInfo,
  readServerVariables,
  readTags,
  schemaSlot,
  type SchemaContext,
} from './document-parts';
import { createSchemaRegistry } from './schema-registry';
import {
  asBoolean,
  asJsonValue,
  asString,
  asStringArray,
  isPlainObject,
  isUnknownArray,
} from './guards';
import { followStructuralReference } from './json-pointer';
import { buildNavigation } from './navigation';
import {
  assignOperationIdentities,
  isStandardHttpMethod,
  operationNodeId,
  pathSlug,
  STANDARD_HTTP_METHODS,
} from './operation-identity';
import { compareByCodePoint } from '../../hashing/domain/canonical';
import type { IRRelationship } from '../../ir/domain/relationship.types';
import { orderRelationships } from '../../topology/domain/relationships';

/**
 * OpenAPI intake for 3.0, 3.1 and 3.2, per SPEC 5.4 and SPEC 23.
 *
 * Version differences are resolved here so that nothing downstream of `core` has to know which
 * version the document was written in.
 *
 * Ordering is canonical rather than taken from object iteration. Two facts force this: a
 * document merged from several sources has no meaningful key order, and JavaScript objects
 * iterate integer like keys, which HTTP status codes are, in numeric order. Operations are
 * therefore ordered by path and then by method, responses by status code, and schemas by name.
 */

/** Options for {@link normalizeOpenApiDocument}. */
export interface NormalizeOpenApiOptions {
  /** Identity of the document, used as the federation key. Defaults to a slug of the title. */
  readonly documentId?: string;
  /** Documents that external references point at, keyed by the URI before the `#`. */
  readonly externalDocuments?: Readonly<Record<string, unknown>>;
  /** Limit on reference chain depth. */
  readonly cycleDepth?: number;
}

const SUPPORTED_MAJOR_MINOR = ['3.0', '3.1', '3.2'];

const SECURITY_SCHEME_TYPES = [
  'apiKey',
  'http',
  'oauth2',
  'openIdConnect',
  'mutualTLS',
] as const satisfies readonly IRSecuritySchemeType[];

const PARAMETER_LOCATIONS = [
  'path',
  'query',
  'header',
  'cookie',
] as const satisfies readonly IRParameterLocation[];

const PARAMETER_STYLES = [
  'matrix',
  'label',
  'simple',
  'form',
  'spaceDelimited',
  'pipeDelimited',
  'deepObject',
] as const satisfies readonly IRParameterStyle[];

/**
 * Members OpenAPI's Path Item Object declares that are not operations, per SPEC 5.4.
 *
 * ENUMERATED RATHER THAN GUESSED, because this list is what keeps the unread key rule off an
 * ordinary document: everything here, plus any `x-` key, is a member the reader either reads
 * elsewhere or deliberately does not read, and neither is an operation nobody saw.
 */
const PATH_ITEM_FIELDS: readonly string[] = [
  '$ref',
  'summary',
  'description',
  'servers',
  'parameters',
  'additionalOperations',
];

/** Where a block of Path Items was written, for a refusal, an unread key and a security position. */
interface PathItemsAt {
  readonly position: IRUnreadKeyPosition;
  /** The callback's name as written. Present exactly when `position` is `callback`. */
  readonly callback?: string;
  /** Node id of the operation the callback hangs off. Present exactly when `position` is `callback`. */
  readonly parentId?: string;
}

/**
 * The address of one Path Item in the document's own coordinates, per SPEC 5.4.
 *
 * "SOMEWHERE IN THIS DOCUMENT" IS NOT AN ADDRESS. The three blocks are keyed by three different
 * things, a path, a name the document invents and a runtime expression, so a refusal that printed
 * only the key would send a reader to a member they cannot find.
 *
 * @param at - Which block the Path Item was written in
 * @param path - The key it was written under, exactly as written
 * @returns The address, for a message a reader can act on
 */
function pathItemWhere(at: PathItemsAt, path: string): string {
  if (at.position === 'paths') return `path item ${JSON.stringify(path)}`;
  if (at.position === 'webhooks') return `webhook ${JSON.stringify(path)}`;

  return (
    `path item ${JSON.stringify(path)} of callback ${JSON.stringify(at.callback ?? '')} ` +
    `of operation ${JSON.stringify(at.parentId ?? '')}`
  );
}

/** The address a `security` list at one Path Item's operation is written at. */
function securityWhere(at: PathItemsAt, path: string, method: string): string {
  const block =
    at.position === 'callback'
      ? `callbacks.${JSON.stringify(at.callback ?? '')}.${JSON.stringify(path)}`
      : `${at.position}.${JSON.stringify(path)}`;

  return `${block}.${method}.security`;
}

interface Context extends SchemaContext {
  /** Requirement declared on the document, inherited by an operation that declares none. */
  readonly documentSecurity: readonly IRSecurityRequirement[];
  /** Names `components.securitySchemes` declares, which a requirement may name and nothing else. */
  readonly securitySchemeIds: ReadonlySet<string>;
}

function readExamples(raw: unknown): Readonly<Record<string, IRExample>> | undefined {
  if (!isPlainObject(raw)) return undefined;

  const examples: Record<string, IRExample> = {};
  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const source = raw[name];
    if (!isPlainObject(source)) continue;

    const example: { -readonly [Key in keyof IRExample]: IRExample[Key] } = {};
    const summary = asString(source.summary);
    const description = asString(source.description);
    const value = asJsonValue(source.value);
    if (summary !== undefined) example.summary = summary;
    if (description !== undefined) example.description = description;
    if (value !== undefined) example.value = value;
    examples[name] = example;
  }

  return Object.keys(examples).length > 0 ? examples : undefined;
}

/**
 * Call samples an author wrote on an operation, per SPEC 18.
 *
 * BOTH SPELLINGS ARE READ AND THE CURRENT ONE WINS. `x-codeSamples` is what the specification
 * extension is called today and what `@ApiSample` writes; `x-code-samples` is the name the same
 * extension had before, and documents in the wild still carry it. Reading one of the two would
 * mean a reference that silently draws no samples for a document that has them, which is the
 * failure this whole milestone keeps removing.
 *
 * A SAMPLE WITH NO SOURCE IS NOT A SAMPLE and is dropped rather than drawn as an empty tab. The
 * label falls back to the language, because a tab has to say something and the language is what
 * the author already told us.
 *
 * AN EMPTY LABEL IS NO LABEL, AND WRITING THAT AS `?? lang` MADE THE FALLBACK NEVER FIRE. An empty
 * string is a string, so `label: ""` reached the IR as `""` and the two shipped themes then
 * disagreed about it: telltale drew the language and the default theme drew the empty string, so
 * on the default theme a Ruby sample arrived as a nameless button and the word Ruby appeared
 * nowhere on the page. It is fixed here rather than in either theme, because a theme guarding a
 * value the IR should never have carried is the second answer that drifts from the first.
 *
 * @param source - The operation object as the document wrote it
 * @returns The samples in document order, or nothing when there are none worth drawing
 */
function readCodeSamples(source: Record<string, unknown>): IRCodeSample[] | undefined {
  const raw = source['x-codeSamples'] ?? source['x-code-samples'];
  if (!isUnknownArray(raw)) return undefined;

  const samples: IRCodeSample[] = [];

  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;

    const lang = asString(entry.lang);
    const code = asString(entry.source);
    if (lang === undefined || code === undefined || code === '') continue;

    const label = asString(entry.label);
    samples.push({ lang, label: label === undefined || label === '' ? lang : label, source: code });
  }

  return samples.length > 0 ? samples : undefined;
}

function readServers(raw: unknown): IRServer[] {
  if (!isUnknownArray(raw)) return [];

  const servers: IRServer[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const url = asString(entry.url);
    if (url === undefined) continue;

    const server: { -readonly [Key in keyof IRServer]: IRServer[Key] } = { url };
    const description = asString(entry.description);
    const protocol = asString(entry.protocol);
    const protocolVersion = asString(entry.protocolVersion);
    if (description !== undefined) server.description = description;
    if (protocol !== undefined) server.protocol = protocol;
    if (protocolVersion !== undefined) server.protocolVersion = protocolVersion;

    const variables = readServerVariables(entry.variables);
    if (variables !== undefined) server.variables = variables;

    servers.push(server);
  }

  return servers;
}

/**
 * The server an OpenAPI document has when it declares none.
 *
 * The specification is explicit: with `servers` absent or an empty array, the document has one
 * Server Object whose url is `/`. It is a relative reference, meaning "wherever this document is
 * served from", and a consumer resolves it against the location the document came from.
 */
export const DEFAULT_SERVER_URL = '/';

/**
 * The document's servers, with the specification's default applied.
 *
 * THE DEFAULT IS PART OF THE DOCUMENT, NOT A CONVENIENCE FOR ONE CONSUMER. Leaving the list
 * empty made three different things wrong at once: the try-it console reported that there was
 * nowhere to send, the server selector had nothing to select, and the proxy allowlist of SPEC
 * 14.5, which T040 derives from `servers`, would have been derived from an absence rather than
 * from the default. Each of those would have been fixed separately and differently.
 *
 * The default is applied whenever the effective list is empty, including when the document
 * wrote entries this normalizer could not read. A server object with no url is skipped like
 * every other malformed member, per T004, and a document whose only declaration was skipped has
 * declared no usable server; the alternative is a reference with nowhere to send and nothing
 * saying why.
 *
 * IT DOES NOT MAKE THE PROXY ALLOWLIST NON EMPTY. SPEC 14.5 turns the proxy off on an empty
 * allowlist, and an allowlist is a set of hosts: `/` is relative and names no host, so it
 * contributes nothing to it and the proxy stays off exactly where it was off before.
 *
 * @param raw - The `servers` member as written, untrusted
 * @returns The declared servers, or the single default one
 */
function readDocumentServers(raw: unknown): IRServer[] {
  const declared = readServers(raw);

  return declared.length > 0 ? declared : [{ url: DEFAULT_SERVER_URL }];
}

function readServerOverrides(raw: unknown): IRServerOverride[] {
  return readServers(raw).map((server) => {
    const override: { -readonly [Key in keyof IRServerOverride]: IRServerOverride[Key] } = {
      url: server.url,
    };
    if (server.description !== undefined) override.description = server.description;
    return override;
  });
}

function readOAuthFlow(raw: unknown): IROAuthFlow | undefined {
  if (!isPlainObject(raw)) return undefined;

  const scopes: Record<string, string> = {};
  if (isPlainObject(raw.scopes)) {
    for (const name of Object.keys(raw.scopes).sort(compareByCodePoint)) {
      const description = asString(raw.scopes[name]);
      scopes[name] = description ?? '';
    }
  }

  const flow: { -readonly [Key in keyof IROAuthFlow]: IROAuthFlow[Key] } = { scopes };
  const authorizationUrl = asString(raw.authorizationUrl);
  const tokenUrl = asString(raw.tokenUrl);
  const refreshUrl = asString(raw.refreshUrl);
  const deviceAuthorizationUrl = asString(raw.deviceAuthorizationUrl);
  if (authorizationUrl !== undefined) flow.authorizationUrl = authorizationUrl;
  if (tokenUrl !== undefined) flow.tokenUrl = tokenUrl;
  if (refreshUrl !== undefined) flow.refreshUrl = refreshUrl;
  if (deviceAuthorizationUrl !== undefined) flow.deviceAuthorizationUrl = deviceAuthorizationUrl;

  return flow;
}

/**
 * Reads `components.securitySchemes` into the document's scheme table, per SPEC 5.4.
 *
 * A TYPE OUTSIDE THE FIVE IS A REFUSAL AND NOT A SKIP, which is the answer SPEC 8.2 already gives
 * on the events side and the reason the two now agree. Skipping left `document.security` empty,
 * and an empty table says "this document declares no scheme"; the document declared one, so the
 * skip printed a reader a false statement in place of a missing one. `type` is required on a
 * Security Scheme Object, so a type that was not written at all is the same refusal.
 *
 * THE REFUSAL NAMES THE POSITION, because the reader who acts on it edits the document rather than
 * this file. OpenAPI writes a scheme in one place only, unlike AsyncAPI, so there is one form of
 * position here where SPEC 8.2 needs three.
 *
 * A `$ref` IS FOLLOWED FIRST, so a scheme written at the spelling `components.securitySchemes`
 * permits does not vanish, and a dangling one is refused rather than read as a scheme with no type.
 * A member written as something other than an object is still skipped: that is the absence of a
 * Security Scheme Object, not a Security Scheme Object with a type nobody declares.
 *
 * @param document - The whole document, which a `$ref` here is resolved against
 * @param raw - The `securitySchemes` member of `components`, untrusted
 * @returns The schemes, ordered by declared name
 * @throws {NormalizeError} When a declared scheme's type is not one of the five
 * @throws {RefResolutionError} When a scheme's `$ref` resolves to nothing or leaves the document
 */
function readSecuritySchemes(document: Record<string, unknown>, raw: unknown): IRSecurityScheme[] {
  if (!isPlainObject(raw)) return [];

  const schemes: IRSecurityScheme[] = [];
  for (const id of Object.keys(raw).sort(compareByCodePoint)) {
    const where = `components.securitySchemes.${id}`;
    const source = followStructuralReference(document, raw[id], where, 'a security scheme');
    if (!isPlainObject(source)) continue;

    const type = SECURITY_SCHEME_TYPES.find((candidate) => candidate === source.type);
    if (type === undefined) {
      // TWO SENTENCES, BECAUSE THEY ARE TWO DEFECTS. A member that was never written is missing,
      // and saying it "declares the security scheme type undefined" prints the reader a word the
      // document does not contain and sends them looking for it.
      throw invalidDocument(
        Object.hasOwn(source, 'type')
          ? `${where} declares the security scheme type ${JSON.stringify(source.type)}, and ` +
              `OpenAPI declares five: ${SECURITY_SCHEME_TYPES.join(', ')}`
          : `${where} writes no type, which a Security Scheme Object requires; OpenAPI declares ` +
              `five: ${SECURITY_SCHEME_TYPES.join(', ')}`,
        Object.hasOwn(source, 'type')
          ? { position: where, type: source.type }
          : { position: where },
      );
    }

    const scheme: { -readonly [Key in keyof IRSecurityScheme]: IRSecurityScheme[Key] } = {
      id,
      type,
    };

    const description = asString(source.description);
    const name = asString(source.name);
    const location = asString(source.in);
    const httpScheme = asString(source.scheme);
    const bearerFormat = asString(source.bearerFormat);
    const openIdConnectUrl = asString(source.openIdConnectUrl);

    if (description !== undefined) scheme.description = description;
    if (name !== undefined) scheme.name = name;
    if (location === 'query' || location === 'header' || location === 'cookie') {
      scheme.in = location;
    }
    if (httpScheme !== undefined) scheme.scheme = httpScheme;
    if (bearerFormat !== undefined) scheme.bearerFormat = bearerFormat;
    if (openIdConnectUrl !== undefined) scheme.openIdConnectUrl = openIdConnectUrl;

    if (isPlainObject(source.flows)) {
      const flows: { -readonly [Key in keyof IROAuthFlows]: IROAuthFlows[Key] } = {};
      const implicit = readOAuthFlow(source.flows.implicit);
      const password = readOAuthFlow(source.flows.password);
      const clientCredentials = readOAuthFlow(source.flows.clientCredentials);
      const authorizationCode = readOAuthFlow(source.flows.authorizationCode);
      const deviceAuthorization = readOAuthFlow(source.flows.deviceAuthorization);
      if (implicit !== undefined) flows.implicit = implicit;
      if (password !== undefined) flows.password = password;
      if (clientCredentials !== undefined) flows.clientCredentials = clientCredentials;
      if (authorizationCode !== undefined) flows.authorizationCode = authorizationCode;
      if (deviceAuthorization !== undefined) flows.deviceAuthorization = deviceAuthorization;
      if (Object.keys(flows).length > 0) scheme.flows = flows;
    }

    schemes.push(scheme);
  }

  return schemes;
}

/**
 * Reads a `security` list into requirements naming the document's own scheme table, per SPEC 5.4.
 *
 * A NAME NOBODY DECLARED IS A REFUSAL, and until 2026-08-30 it was not even a skip: every key found
 * was pushed, so a node left the normalizer carrying `{ schemeId: 'nowhere' }` against an empty
 * table and every consumer that joined the two got nothing, with no finding anywhere. A requirement
 * is a pointer into `components.securitySchemes`, and a pointer at nothing describes a broken
 * document rather than an incomplete one.
 *
 * AN EMPTY REQUIREMENT OBJECT NAMES NOTHING AND IS NOT CHECKED. `security: [{}]` is how OpenAPI
 * says the requirement is optional, so there is no name in it to fail to find.
 *
 * @param raw - The `security` member, untrusted
 * @param declared - The names `components.securitySchemes` declared
 * @param where - The address of this list in the document's own coordinates, for a refusal
 * @returns The requirements, in canonical name order within each entry
 * @throws {NormalizeError} When a requirement names a scheme the document does not declare
 */
function readSecurityRequirements(
  raw: unknown,
  declared: ReadonlySet<string>,
  where: string,
): IRSecurityRequirement[] {
  if (!isUnknownArray(raw)) return [];

  const requirements: IRSecurityRequirement[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isPlainObject(entry)) continue;
    for (const schemeId of Object.keys(entry).sort(compareByCodePoint)) {
      const position = `${where}[${String(index)}]`;
      if (!declared.has(schemeId)) {
        throw invalidDocument(
          `${position} requires the security scheme ${JSON.stringify(schemeId)}, and ` +
            'components.securitySchemes does not declare it',
          { position, schemeId },
        );
      }
      requirements.push({ schemeId, scopes: asStringArray(entry[schemeId]) ?? [] });
    }
  }

  return requirements;
}

function defaultStyle(location: IRParameterLocation): IRParameterStyle {
  return location === 'query' || location === 'cookie' ? 'form' : 'simple';
}

function readParameters(raw: unknown, context: Context, path: string): IRParameter[] {
  if (!isUnknownArray(raw)) return [];

  const parameters: IRParameter[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isPlainObject(entry)) continue;

    const resolved = entry;
    const name = asString(resolved.name);
    const location = PARAMETER_LOCATIONS.find((candidate) => candidate === resolved.in);
    if (name === undefined || location === undefined) continue;

    const style = PARAMETER_STYLES.find((candidate) => candidate === resolved.style);
    const chosenStyle = style ?? defaultStyle(location);
    const explode = asBoolean(resolved.explode) ?? chosenStyle === 'form';

    const parameter: { -readonly [Key in keyof IRParameter]: IRParameter[Key] } = {
      name,
      in: location,
      required: asBoolean(resolved.required) ?? location === 'path',
      style: chosenStyle,
      explode,
    };

    const description = asString(resolved.description);
    const deprecated = asBoolean(resolved.deprecated);
    const allowReserved = asBoolean(resolved.allowReserved);
    const allowEmptyValue = asBoolean(resolved.allowEmptyValue);
    const example = asJsonValue(resolved.example);
    const examples = readExamples(resolved.examples);

    if (description !== undefined) parameter.description = description;
    if (deprecated !== undefined) parameter.deprecated = deprecated;
    if (allowReserved !== undefined) parameter.allowReserved = allowReserved;
    if (allowEmptyValue !== undefined) parameter.allowEmptyValue = allowEmptyValue;
    if (example !== undefined) parameter.example = example;
    if (examples !== undefined) parameter.examples = examples;

    const slot = schemaSlot(
      resolved.schema,
      context,
      `${path}.parameters.${String(index)}.${name}`,
    );
    if (slot !== undefined) parameter.schema = slot;

    parameters.push(parameter);
  }

  return parameters;
}

/**
 * Reads a media type's `encoding` block, per SPEC 14.3 and the T034 amendment.
 *
 * DECLARED SINCE M0 AND FILLED SINCE T034: the field was read and never written, so a consumer
 * could not tell "this document declares no encoding" from "nothing ever filled this in". The
 * multipart part rule of SPEC 14.3 is what it serves: `contentType` here is how a document
 * says a part is not what the default rule would make it.
 */
function readEncoding(
  raw: unknown,
  context: Context,
  path: string,
): Record<string, IREncoding> | undefined {
  if (!isPlainObject(raw)) return undefined;

  const encoding: Record<string, IREncoding> = {};
  for (const property of Object.keys(raw).sort(compareByCodePoint)) {
    const source = raw[property];
    if (!isPlainObject(source)) continue;

    const entry: { -readonly [Key in keyof IREncoding]: IREncoding[Key] } = {};
    const contentType = asString(source.contentType);
    const style = PARAMETER_STYLES.find((candidate) => candidate === source.style);
    const explode = asBoolean(source.explode);
    const allowReserved = asBoolean(source.allowReserved);
    const headers = readHeaders(source.headers, context, `${path}.${property}`);

    if (contentType !== undefined) entry.contentType = contentType;
    if (style !== undefined) entry.style = style;
    if (explode !== undefined) entry.explode = explode;
    if (allowReserved !== undefined) entry.allowReserved = allowReserved;
    if (headers !== undefined) entry.headers = headers;

    encoding[property] = entry;
  }

  return Object.keys(encoding).length > 0 ? encoding : undefined;
}

function readContent(raw: unknown, context: Context, path: string): IRMediaType[] {
  if (!isPlainObject(raw)) return [];

  const media: IRMediaType[] = [];
  for (const mediaType of Object.keys(raw).sort(compareByCodePoint)) {
    const source = raw[mediaType];
    if (!isPlainObject(source)) continue;

    const entry: { -readonly [Key in keyof IRMediaType]: IRMediaType[Key] } = { mediaType };
    const slot = schemaSlot(source.schema, context, `${path}.${mediaType}`);
    const example = asJsonValue(source.example);
    const examples = readExamples(source.examples);
    const encoding = readEncoding(source.encoding, context, `${path}.${mediaType}.encoding`);

    if (slot !== undefined) entry.schema = slot;
    if (example !== undefined) entry.example = example;
    if (examples !== undefined) entry.examples = examples;
    if (encoding !== undefined) entry.encoding = encoding;

    media.push(entry);
  }

  return media;
}

function readHeaders(raw: unknown, context: Context, path: string): IRHeader[] | undefined {
  if (!isPlainObject(raw)) return undefined;

  const headers: IRHeader[] = [];
  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const source = raw[name];
    if (!isPlainObject(source)) continue;

    const header: { -readonly [Key in keyof IRHeader]: IRHeader[Key] } = {
      name,
      required: asBoolean(source.required) ?? false,
    };
    const description = asString(source.description);
    const deprecated = asBoolean(source.deprecated);
    const slot = schemaSlot(source.schema, context, `${path}.headers.${name}`);
    if (description !== undefined) header.description = description;
    if (deprecated !== undefined) header.deprecated = deprecated;
    if (slot !== undefined) header.schema = slot;

    headers.push(header);
  }

  return headers.length > 0 ? headers : undefined;
}

/**
 * Orders status codes: numeric ascending, then `default`, then anything else.
 *
 * The order a document wrote them in is unrecoverable, because a parsed object iterates integer
 * like keys numerically. A canonical order is therefore the only stable choice.
 */
function compareStatusCodes(left: string, right: string): number {
  const leftNumber = Number.parseInt(left, 10);
  const rightNumber = Number.parseInt(right, 10);
  const leftIsNumber = Number.isInteger(leftNumber);
  const rightIsNumber = Number.isInteger(rightNumber);

  if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
  if (leftIsNumber) return -1;
  if (rightIsNumber) return 1;
  if (left === 'default') return -1;
  if (right === 'default') return 1;
  return compareByCodePoint(left, right);
}

function readResponses(raw: unknown, context: Context, path: string): IRResponse[] {
  if (!isPlainObject(raw)) return [];

  const responses: IRResponse[] = [];
  for (const statusCode of Object.keys(raw).sort(compareStatusCodes)) {
    if (statusCode.startsWith('x-')) continue;
    const source = raw[statusCode];
    if (!isPlainObject(source)) continue;

    const response: { -readonly [Key in keyof IRResponse]: IRResponse[Key] } = {
      statusCode,
      content: readContent(source.content, context, `${path}.responses.${statusCode}`),
    };

    const description = asString(source.description);
    const headers = readHeaders(source.headers, context, `${path}.responses.${statusCode}`);
    const itemSchema = schemaSlot(
      source.itemSchema,
      context,
      `${path}.responses.${statusCode}.itemSchema`,
    );
    if (description !== undefined) response.description = description;
    if (headers !== undefined) response.headers = headers;
    if (itemSchema !== undefined) response.itemSchema = itemSchema;

    responses.push(response);
  }

  return responses;
}

function readRequestBody(raw: unknown, context: Context, path: string): IRRequestBody | undefined {
  if (!isPlainObject(raw)) return undefined;

  const body: { -readonly [Key in keyof IRRequestBody]: IRRequestBody[Key] } = {
    required: asBoolean(raw.required) ?? false,
    content: readContent(raw.content, context, `${path}.requestBody`),
  };
  const description = asString(raw.description);
  if (description !== undefined) body.description = description;

  return body;
}

interface RawOperation {
  readonly method: string;
  readonly path: string;
  readonly source: Record<string, unknown>;
  readonly pathItem: Record<string, unknown>;
  /** Where this operation's `security` list is written, in the document's own coordinates. */
  readonly securityWhere: string;
}

/**
 * Resolves a Path Item written as a reference to the Path Item it names, per SPEC 5.4.
 *
 * THE CANONICAL SPELLING RESOLVES, so a document that writes `#/components/pathItems/*` and the
 * same document written inline produce one IR and one hash. Until 2026-08-30 the reference was not
 * followed at all, which walked the key `$ref` as if it were a method and its string value as if it
 * were an Operation Object: measured on the tree at that date, the reference spelling gave zero
 * nodes under `paths`, zero under `webhooks` and no callback node, with `unreadKeys` empty in all
 * three. It is the same defect `T052` removed one level up, at the Callback Object itself.
 *
 * MEMBERS WRITTEN BESIDE THE `$ref` LIE OVER THE TARGET. OpenAPI 3.1.1 says that of `summary` and
 * `description`; taking the target and discarding whatever else was written beside it would swap
 * one silent loss for another, so the referencing object's own members win.
 *
 * @param written - The Path Item member exactly as the document wrote it, untrusted
 * @param context - The document being normalized
 * @param where - The address of this Path Item, for the message a reader gets
 * @returns The Path Item, or the member itself when it was not a reference
 * @throws {RefResolutionError} When the reference resolves to nothing or leaves the document
 * @throws {CycleDepthError} When the chain of references returns to where it has been
 */
function resolvePathItem(written: unknown, context: Context, where: string): unknown {
  const reference = isPlainObject(written) ? asString(written.$ref) : undefined;
  if (reference === undefined) return written;

  const resolved = followStructuralReference(context.document, written, where, 'a path item');
  if (!isPlainObject(resolved)) {
    throw new RefResolutionError(
      `${where} points at ${reference}, which is not a Path Item Object`,
      ErrorCode.NORM_REF_UNRESOLVED,
      undefined,
      { reference, where },
    );
  }

  const beside = Object.fromEntries(
    Object.entries(written as Record<string, unknown>).filter(([key]) => key !== '$ref'),
  );

  return Object.keys(beside).length === 0 ? resolved : { ...resolved, ...beside };
}

/**
 * Every path item key that names an operation, split into the ones this reads and the ones it
 * will not, per SPEC 5.4 and SPEC 7.1's `operation-key-unread`.
 *
 * THE SECOND HALF IS THE POINT, and since 2026-08-30 it has two cases rather than one. A key
 * spelled `GET` is not a path item field in any version of OpenAPI, and neither is `fetch`; nothing
 * here reads either, and before `T043` for the first and before this date for the second, the
 * operation left the document with nothing anywhere recording that it had. Both are recorded rather
 * than read, because reading either would invent a document the specification does not describe,
 * and reported through the doctor, because SPEC 6 says a fact that cannot be obtained is named and
 * never silently substituted. The second case carries no `method`: there is none to carry, and a
 * blank one would be the guess the same rule forbids.
 *
 * WHAT IS NOT RECORDED IS ENUMERATED. {@link PATH_ITEM_FIELDS} and any `x-` key are members the
 * Path Item Object itself declares, and a member written as something other than an object is the
 * absence of an Operation Object rather than one under a key nobody reads.
 *
 * @param raw - The `paths`, `webhooks` or Callback Object member, untrusted
 * @param context - The document being normalized, which a Path Item `$ref` resolves against
 * @param at - Which block this is, so a refusal and an unread key both carry an address
 * @returns The operations in canonical order and the keys that named one and were not read
 * @throws {RefResolutionError} When a Path Item reference resolves to nothing or leaves the document
 */
function collectPathItems(
  raw: unknown,
  context: Context,
  at: PathItemsAt,
): {
  readonly operations: RawOperation[];
  readonly unread: IRUnreadKey[];
} {
  if (!isPlainObject(raw)) return { operations: [], unread: [] };

  const operations: RawOperation[] = [];
  const unread: IRUnreadKey[] = [];

  for (const path of Object.keys(raw).sort(compareByCodePoint)) {
    const pathItem = resolvePathItem(raw[path], context, pathItemWhere(at, path));
    if (!isPlainObject(pathItem)) continue;

    for (const key of Object.keys(pathItem).sort(compareByCodePoint)) {
      if (key.startsWith('x-') || PATH_ITEM_FIELDS.includes(key)) continue;
      const method = key.toLowerCase();
      if (key === method && isStandardHttpMethod(method)) continue;
      if (!isPlainObject(pathItem[key])) continue;

      const entry: { -readonly [Key in keyof IRUnreadKey]: IRUnreadKey[Key] } = {
        path,
        key,
        position: at.position,
      };
      if (isStandardHttpMethod(method)) entry.method = method;
      if (at.callback !== undefined) entry.callback = at.callback;
      if (at.parentId !== undefined) entry.parentId = at.parentId;
      unread.push(entry);
    }

    for (const method of STANDARD_HTTP_METHODS) {
      const source = pathItem[method];
      if (isPlainObject(source)) {
        operations.push({
          method,
          path,
          source,
          pathItem,
          securityWhere: securityWhere(at, path, method),
        });
      }
    }

    const additional = pathItem.additionalOperations;
    if (!isPlainObject(additional)) continue;

    for (const rawMethod of Object.keys(additional).sort(compareByCodePoint)) {
      const source = additional[rawMethod];
      const method = rawMethod.toLowerCase();
      if (!isPlainObject(source)) continue;

      // THE SKIP IS A CORRECT READING AND WAS A SILENT ONE, which is SPEC 5.4's eighth row and the
      // mirror of its fourth. `additionalOperations` is defined as the methods the specification
      // does not enumerate, so an enumerated one written there belongs to the Path Item itself; a
      // reader who wrote it here gets told rather than shown a reference with the operation gone.
      if (isStandardHttpMethod(method)) {
        unread.push({ path, key: rawMethod, method, position: 'additional-operations' });
        continue;
      }

      operations.push({
        method,
        path,
        source,
        pathItem,
        securityWhere: securityWhere(at, path, method),
      });
    }
  }

  return { operations, unread };
}

/** What one operation's `callbacks` member turned into. */
interface ReadCallbacks {
  /** Callback node ids, keyed by the name the document wrote, for `IROperation.callbacks`. */
  readonly byName: Record<string, readonly string[]>;
  /** The callback operations themselves, as nodes of their own. */
  readonly nodes: readonly IROperation[];
  /** Path item keys inside a callback that name an operation this does not read. */
  readonly unread: readonly IRUnreadKey[];
}

/**
 * Resolves one callback member to the Callback Object it names, per SPEC 9.3.
 *
 * A REFERENCE IS FOLLOWED, ANYTHING ELSE IS LEFT ALONE. Only a member that actually writes `$ref`
 * goes through the reference machinery, and only such a member can be refused here: a callback
 * written inline with a member of the wrong shape is skipped by the reader below exactly as it was
 * before, because narrowing that is a separate question from this one.
 *
 * REFUSAL RATHER THAN SILENCE IS THE FAIL CLOSED POLICY, per SPEC 9.4. A reference that resolves
 * to nothing, leaves the document, stands on itself, or lands on something that is not an object
 * describes a broken document, and drawing it as a document with no callback would render it as if
 * nothing were wrong. `core` has no `discoveryProblems` of its own to write into, so the refusal is
 * the channel, and it names both the callback and the operation it hangs off.
 *
 * @param written - The callback member exactly as the document wrote it, untrusted
 * @param context - The document being normalized
 * @param name - The callback's name, as the document wrote it
 * @param parentId - Node id of the operation the callback hangs off
 * @returns The Callback Object, or the member itself when it was not a reference
 * @throws {RefResolutionError} When the reference resolves to nothing, leaves the document, or
 *         resolves to something that is not a Callback Object
 * @throws {CycleDepthError} When the reference stands on itself
 */
function resolveCallback(
  written: unknown,
  context: Context,
  name: string,
  parentId: string,
): unknown {
  const reference = isPlainObject(written) ? asString(written.$ref) : undefined;
  if (reference === undefined) return written;

  const where = `callback ${name} of operation ${parentId}`;
  const resolved = followStructuralReference(context.document, written, where, 'a callback');
  if (isPlainObject(resolved)) return resolved;

  throw new RefResolutionError(
    `${where} points at ${reference}, which is not a Callback Object`,
    ErrorCode.NORM_REF_UNRESOLVED,
    undefined,
    { reference, where },
  );
}

/**
 * Reads one operation's callbacks, per SPEC 9.3.
 *
 * A CALLBACK IS OPERATIONS, SO IT BECOMES NODES. `IROperation.callbacks` was declared in `T002`
 * and had no producer until `T052`, which meant a document declaring callbacks rendered as a
 * document with none. The Path Item under a callback name holds operations exactly like any other
 * Path Item, so the same reader reads them, and the runtime expression the document wrote is
 * carried as the operation's `path` verbatim: it is what the document said the request goes to.
 *
 * A CALLBACK NODE IS NOT IN THE NAVIGATION, and that is a positioning decision rather than an
 * omission. Navigation is built from tags over the document's own operations, and a callback
 * hangs off the operation that declares it, not off a tag. It is reachable by id, by search and by
 * the topology edge that names it.
 *
 * A CALLBACK WRITTEN AS A REFERENCE IS THE SAME CALLBACK, per SPEC 9.3. `#/components/callbacks/*`
 * is the spelling OpenAPI's own examples use, and reading the member without following it walked
 * the key `$ref` as if it were a runtime expression and its string value as if it were a Path
 * Item: measured on a built `@openref/core`, the inline spelling gave one edge and two nodes and
 * the reference spelling gave none of either, with nothing in `unreadKeys` to say so. The name
 * stays the one the document wrote here rather than the last segment of the pointer, because the
 * reference says where the definition lives and not what it is called at this position.
 *
 * @param entry - The operation whose callbacks are being read, untrusted
 * @param context - Schema registry, dialect and inherited security
 * @param parentId - Node id of the operation the callbacks hang off
 * @param taken - Node ids already assigned, added to as ids are handed out
 * @returns The ids by name, the nodes, and any unread key found inside a callback
 * @throws {RefResolutionError} When a callback reference resolves to nothing, leaves the document
 *         or resolves to something that is not a Callback Object
 * @throws {CycleDepthError} When a callback reference stands on itself
 */
function readCallbacks(
  entry: RawOperation,
  context: Context,
  parentId: string,
  taken: Set<string>,
): ReadCallbacks {
  const raw = entry.source.callbacks;
  if (!isPlainObject(raw)) return { byName: {}, nodes: [], unread: [] };

  const byName: Record<string, readonly string[]> = {};
  const nodes: IROperation[] = [];
  const unread: IRUnreadKey[] = [];

  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const collected = collectPathItems(
      resolveCallback(raw[name], context, name, parentId),
      context,
      {
        position: 'callback',
        callback: name,
        parentId,
      },
    );
    unread.push(...collected.unread);

    const ids: string[] = [];
    for (const call of collected.operations) {
      const base = `callback-${parentId}-${pathSlug(name)}-${operationNodeId(call.method, call.path)}`;
      let id = base;
      let suffix = 2;
      while (taken.has(id)) {
        id = `${base}-${String(suffix)}`;
        suffix += 1;
      }
      taken.add(id);
      nodes.push(readOperation(call, context, id));
      ids.push(id);
    }

    if (ids.length > 0) byName[name] = ids;
  }

  return { byName, nodes, unread };
}

function readOperation(entry: RawOperation, context: Context, id: string): IROperation {
  const { method, path, source, pathItem } = entry;

  const inherited = readParameters(pathItem.parameters, context, `${id}.path`);
  const own = readParameters(source.parameters, context, id);
  const parameters = [
    ...inherited.filter(
      (candidate) =>
        !own.some((override) => override.name === candidate.name && override.in === candidate.in),
    ),
    ...own,
  ];

  const operation: { -readonly [Key in keyof IROperation]: IROperation[Key] } = {
    kind: 'operation',
    id,
    method,
    path,
    tags: asStringArray(source.tags) ?? [],
    deprecated: asBoolean(source.deprecated) ?? false,
    parameters,
    responses: readResponses(source.responses, context, id),
    // An operation that writes `security: []` is declaring that it needs none, which is not the
    // same as saying nothing. Only the second inherits the document level requirement.
    security: Object.hasOwn(source, 'security')
      ? readSecurityRequirements(source.security, context.securitySchemeIds, entry.securityWhere)
      : [...context.documentSecurity],
    servers: readServerOverrides(source.servers ?? pathItem.servers),
  };

  const summary = asString(source.summary) ?? asString(pathItem.summary);
  const description = asString(source.description) ?? asString(pathItem.description);
  const body = readRequestBody(source.requestBody, context, id);
  const extensions = readExtensions(source);
  const codeSamples = readCodeSamples(source);

  if (summary !== undefined) operation.summary = summary;
  if (description !== undefined) operation.description = description;
  if (body !== undefined) operation.requestBody = body;
  if (codeSamples !== undefined) operation.codeSamples = codeSamples;
  if (extensions !== undefined) operation.extensions = extensions;

  return operation;
}

function readVersion(document: Record<string, unknown>): string {
  const version = asString(document.openapi);
  if (version === undefined) {
    if (asString(document.swagger) !== undefined) {
      throw new UnsupportedDialectError(
        'Swagger 2.0 is not supported; convert the document to OpenAPI 3.x first',
        ErrorCode.NORM_UNSUPPORTED_DIALECT,
        undefined,
        { swagger: asString(document.swagger) },
      );
    }
    throw invalidDocument('the document has no openapi version field');
  }

  const majorMinor = version.split('.').slice(0, 2).join('.');
  if (!SUPPORTED_MAJOR_MINOR.includes(majorMinor)) {
    throw new UnsupportedDialectError(
      `OpenAPI ${version} is not supported; supported versions are ${SUPPORTED_MAJOR_MINOR.join(', ')}`,
      ErrorCode.NORM_UNSUPPORTED_DIALECT,
      undefined,
      { version },
    );
  }

  return majorMinor;
}

/**
 * Normalizes an OpenAPI 3.0, 3.1 or 3.2 document into the intermediate representation.
 *
 * A 3.0 document and its hand written 3.1 equivalent produce the same IR: `nullable` becomes a
 * type union with `null`, and a Schema Object's single `example` becomes `examples`. 3.2 fields
 * that have no earlier equivalent, `itemSchema`, `additionalOperations`, the `query` method and
 * hierarchical tags, are carried through as they are.
 *
 * @param input - Parsed document, untrusted
 * @param options - Document id, external documents and cycle depth
 * @returns The document, fully resolved, ordered canonically and hashed
 * @throws {UnsupportedDialectError} For Swagger 2.0 and for an OpenAPI version outside 3.0 to 3.2
 * @throws {NormalizeError} When the document is malformed
 *
 * @example
 * const ir = normalizeOpenApiDocument(parseSpecification(text));
 */
export function normalizeOpenApiDocument(
  input: unknown,
  options: NormalizeOpenApiOptions = {},
): IRDocument {
  if (!isPlainObject(input)) throw invalidDocument('the document is not an object');

  readVersion(input);

  // THE SCHEME TABLE IS READ BEFORE ANY REQUIREMENT, per SPEC 5.4, because a requirement is a
  // pointer into it and a pointer cannot be checked against a table nobody has read yet.
  const securitySchemes = readSecuritySchemes(
    input,
    isPlainObject(input.components) ? input.components.securitySchemes : undefined,
  );
  const securitySchemeIds = new Set(securitySchemes.map((scheme) => scheme.id));

  const context: Context = {
    document: input,
    // Every OpenAPI schema is uplifted to 3.1 semantics, so the normalized dialect is the same
    // for all three input versions. That is what makes a 3.0 document and its 3.1 equivalent
    // produce one IR. `openapi-3.0` stays available for a schema that cannot be uplifted.
    dialect: 'json-schema-2020-12',
    namedSchemas: new Set(
      isPlainObject(input.components) && isPlainObject(input.components.schemas)
        ? Object.keys(input.components.schemas)
        : [],
    ),
    externalDocuments: options.externalDocuments ?? {},
    cycleDepth: options.cycleDepth,
    registry: createSchemaRegistry(),
    readerProblems: [],
    securitySchemeIds,
    documentSecurity: readSecurityRequirements(input.security, securitySchemeIds, 'security'),
  };

  const info = readInfo(input.info);
  produceDeclaredSchemas(context, context.namedSchemas);

  const paths = collectPathItems(input.paths, context, { position: 'paths' });
  const rawOperations = paths.operations;
  const identities = assignOperationIdentities(
    rawOperations.map((entry) => {
      const raw = asString(entry.source.operationId);
      return raw === undefined
        ? { method: entry.method, path: entry.path }
        : { method: entry.method, path: entry.path, rawOperationId: raw };
    }),
  );

  const operations = rawOperations.map((entry, index) => {
    const identity = identities[index];
    const operation = readOperation(entry, context, identity?.id ?? entry.method);
    const withIdentity: { -readonly [Key in keyof IROperation]: IROperation[Key] } = {
      ...operation,
    };
    if (identity !== undefined) {
      withIdentity.operationId = identity.operationId;
      if (identity.rawOperationId !== undefined) {
        withIdentity.rawOperationId = identity.rawOperationId;
      }
    }
    return withIdentity;
  });

  // THE WEBHOOK BLOCK'S UNREAD KEYS ARE KEPT, and until 2026-08-30 they were collected and thrown
  // away by a wrapper that returned only the operations, so a webhook written under `GET` was as
  // silent as it had been before `T043` gave the same defect under `paths` a rule.
  const webhookBlock = collectPathItems(input.webhooks, context, { position: 'webhooks' });
  const rawWebhooks = webhookBlock.operations;
  const webhookIdentities = assignOperationIdentities(
    rawWebhooks.map((entry) => ({ method: entry.method, path: entry.path })),
  );
  const webhookOperations = rawWebhooks.map((entry, index) =>
    readOperation(entry, context, `webhook-${webhookIdentities[index]?.id ?? entry.method}`),
  );

  const documentId = options.documentId ?? documentSlug(info.title);

  // THE CALLBACK PASS RUNS AFTER BOTH IDENTITY PASSES AND NOT INSIDE `readOperation`, because a
  // callback node id has to avoid every id the document's own operations and webhooks already
  // took, and those are not all known until both are assigned.
  const taken = new Set<string>([
    ...operations.map((operation) => operation.id),
    ...webhookOperations.map((operation) => operation.id),
  ]);
  const callbackNodes: IROperation[] = [];
  const callbackUnread: IRUnreadKey[] = [];
  const relationships: IRRelationship[] = [];

  operations.forEach((operation, index) => {
    const entry = rawOperations[index];
    if (entry === undefined) return;

    const read = readCallbacks(entry, context, operation.id, taken);
    callbackNodes.push(...read.nodes);
    callbackUnread.push(...read.unread);
    if (Object.keys(read.byName).length === 0) return;

    operation.callbacks = read.byName;
    for (const ids of Object.values(read.byName))
      for (const id of ids)
        relationships.push({
          from: operation.id,
          fromKind: 'node',
          to: id,
          toKind: 'node',
          type: 'callback',
          confidence: 'declared',
        });
  });

  // A WEBHOOK EDGE STARTS AT THE SERVICE AND NOT AT AN OPERATION, per SPEC 9.3. `webhooks` is a
  // document level member: it says this API sends these requests, without saying which of its own
  // operations causes one, and inventing a source operation would be the guess SPEC 9 forbids.
  for (const webhook of webhookOperations)
    relationships.push({
      from: documentId,
      fromKind: 'service',
      to: webhook.id,
      toKind: 'node',
      type: 'webhook',
      confidence: 'declared',
    });

  const schemas = collectNamedSchemas(context);

  const nodes = new Map<string, IRNode>(
    [...operations, ...callbackNodes].map((operation) => [operation.id, operation]),
  );
  const webhooks = new Map<string, IRNode>(
    webhookOperations.map((operation) => [operation.id, operation]),
  );

  const navigation = buildNavigation({
    tags: readTags(input.tags),
    nodes: operations,
    schemas,
  });

  const document: { -readonly [Key in keyof IRDocument]: IRDocument[Key] } = {
    id: documentId,
    kind: 'http',
    hash: '',
    info,
    servers: readDocumentServers(input.servers),
    navigation,
    nodes,
    schemas: new Map(schemas.map((schema) => [schema.id, schema])),
    security: securitySchemes,
    relationships: orderRelationships(relationships),
    webhooks,
  };

  const extensions = readExtensions(input);
  const unread = [...paths.unread, ...webhookBlock.unread, ...callbackUnread];
  if (extensions !== undefined) document.extensions = extensions;
  if (unread.length > 0) document.unreadKeys = unread;
  if (context.readerProblems.length > 0) document.readerProblems = context.readerProblems;

  return finalizeDocument(document);
}

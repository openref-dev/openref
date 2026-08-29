import { finalizeDocument } from '../../hashing/domain/hash';
import type {
  IRDocument,
  IRUnreadKey,
  IROAuthFlow,
  IROAuthFlows,
  IRSecurityScheme,
  IRSecuritySchemeType,
  IRServer,
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
import { ErrorCode, UnsupportedDialectError } from '../../shared/errors/index';
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
import { buildNavigation } from './navigation';
import {
  assignOperationIdentities,
  isStandardHttpMethod,
  STANDARD_HTTP_METHODS,
} from './operation-identity';
import { compareByCodePoint } from '../../hashing/domain/canonical';

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

interface Context extends SchemaContext {
  /** Requirement declared on the document, inherited by an operation that declares none. */
  readonly documentSecurity: readonly IRSecurityRequirement[];
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

    samples.push({ lang, label: asString(entry.label) ?? lang, source: code });
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

function readSecuritySchemes(raw: unknown): IRSecurityScheme[] {
  if (!isPlainObject(raw)) return [];

  const schemes: IRSecurityScheme[] = [];
  for (const id of Object.keys(raw).sort(compareByCodePoint)) {
    const source = raw[id];
    if (!isPlainObject(source)) continue;

    const type = SECURITY_SCHEME_TYPES.find((candidate) => candidate === source.type);
    if (type === undefined) continue;

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

function readSecurityRequirements(raw: unknown): IRSecurityRequirement[] {
  if (!isUnknownArray(raw)) return [];

  const requirements: IRSecurityRequirement[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    for (const schemeId of Object.keys(entry).sort(compareByCodePoint)) {
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
}

/**
 * Collects every operation in canonical order: by path, then by method.
 *
 * OpenAPI 3.2 `additionalOperations` is keyed by method names the specification does not
 * enumerate. Those operations are collected too, after the enumerated ones, in alphabetical
 * order of the method name.
 */
function collectOperations(raw: unknown): RawOperation[] {
  return collectPathItems(raw).operations;
}

/**
 * Every path item key that names an operation, split into the ones this reads and the ones it
 * will not, per SPEC 7.1's `operation-key-unread` as added by `T043`.
 *
 * THE SECOND HALF IS THE POINT. A key spelled `GET` is not a path item field in any version of
 * OpenAPI, so nothing here reads it and nothing should; before `T043` that meant the operation
 * left the document with nothing anywhere recording that it had. It is recorded rather than read,
 * because reading it would invent a document the specification does not describe, and reported
 * through the doctor, because SPEC 6 says a fact that cannot be obtained is named and never
 * silently substituted.
 */
function collectPathItems(raw: unknown): {
  readonly operations: RawOperation[];
  readonly unread: IRUnreadKey[];
} {
  if (!isPlainObject(raw)) return { operations: [], unread: [] };

  const operations: RawOperation[] = [];
  const unread: IRUnreadKey[] = [];

  for (const path of Object.keys(raw).sort(compareByCodePoint)) {
    const pathItem = raw[path];
    if (!isPlainObject(pathItem)) continue;

    for (const key of Object.keys(pathItem).sort(compareByCodePoint)) {
      const method = key.toLowerCase();
      if (key === method || !isStandardHttpMethod(method)) continue;
      if (!isPlainObject(pathItem[key])) continue;
      unread.push({ path, key, method });
    }

    for (const method of STANDARD_HTTP_METHODS) {
      const source = pathItem[method];
      if (isPlainObject(source)) operations.push({ method, path, source, pathItem });
    }

    const additional = pathItem.additionalOperations;
    if (!isPlainObject(additional)) continue;

    for (const rawMethod of Object.keys(additional).sort(compareByCodePoint)) {
      const source = additional[rawMethod];
      const method = rawMethod.toLowerCase();
      if (!isPlainObject(source) || isStandardHttpMethod(method)) continue;
      operations.push({ method, path, source, pathItem });
    }
  }

  return { operations, unread };
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
      ? readSecurityRequirements(source.security)
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
    documentSecurity: readSecurityRequirements(input.security),
  };

  const info = readInfo(input.info);
  produceDeclaredSchemas(context, context.namedSchemas);

  const paths = collectPathItems(input.paths);
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

  const rawWebhooks = collectOperations(input.webhooks);
  const webhookIdentities = assignOperationIdentities(
    rawWebhooks.map((entry) => ({ method: entry.method, path: entry.path })),
  );
  const webhookOperations = rawWebhooks.map((entry, index) =>
    readOperation(entry, context, `webhook-${webhookIdentities[index]?.id ?? entry.method}`),
  );

  const schemas = collectNamedSchemas(context);

  const nodes = new Map<string, IRNode>(operations.map((operation) => [operation.id, operation]));
  const webhooks = new Map<string, IRNode>(
    webhookOperations.map((operation) => [operation.id, operation]),
  );

  const navigation = buildNavigation({
    tags: readTags(input.tags),
    nodes: operations,
    schemas,
  });

  const document: { -readonly [Key in keyof IRDocument]: IRDocument[Key] } = {
    id: options.documentId ?? documentSlug(info.title),
    kind: 'http',
    hash: '',
    info,
    servers: readDocumentServers(input.servers),
    navigation,
    nodes,
    schemas: new Map(schemas.map((schema) => [schema.id, schema])),
    security: readSecuritySchemes(
      isPlainObject(input.components) ? input.components.securitySchemes : undefined,
    ),
    relationships: [],
    webhooks,
  };

  const extensions = readExtensions(input);
  if (extensions !== undefined) document.extensions = extensions;
  if (paths.unread.length > 0) document.unreadKeys = paths.unread;

  return finalizeDocument(document);
}

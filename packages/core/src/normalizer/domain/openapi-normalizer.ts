import { hash } from '../../hashing/domain/hash';
import type {
  IRContact,
  IRDocument,
  IRInfo,
  IRLicense,
  IROAuthFlow,
  IROAuthFlows,
  IRSecurityScheme,
  IRSecuritySchemeType,
  IRServer,
  IRServerVariable,
} from '../../ir/domain/document.types';
import type {
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
import type {
  IRJsonValue,
  IRSchema,
  IRSchemaDialect,
  IRSchemaSlot,
} from '../../ir/domain/schema.types';
import { ErrorCode, NormalizeError, UnsupportedDialectError } from '../../shared/errors/index';
import { buildSchema } from './dialect';
import {
  asBoolean,
  asJsonValue,
  asString,
  asStringArray,
  isPlainObject,
  isUnknownArray,
} from './guards';
import { schemaNameFromReference } from './json-pointer';
import { buildNavigation, type NavigationTag } from './navigation';
import {
  assignOperationIdentities,
  isStandardHttpMethod,
  STANDARD_HTTP_METHODS,
} from './operation-identity';
import { compareByCodePoint } from '../../hashing/domain/canonical';
import type { normalizeSchema } from './schema-normalizer';

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

interface Context {
  readonly document: Record<string, unknown>;
  readonly dialect: IRSchemaDialect;
  readonly namedSchemas: ReadonlySet<string>;
  readonly externalDocuments: Readonly<Record<string, unknown>>;
  readonly cycleDepth: number | undefined;
  /** Requirement declared on the document, inherited by an operation that declares none. */
  readonly documentSecurity: readonly IRSecurityRequirement[];
}

function invalid(message: string, context?: Record<string, unknown>): NormalizeError {
  return new NormalizeError(message, ErrorCode.NORM_DOCUMENT_INVALID, undefined, context);
}

function slug(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'document' : cleaned;
}

function schemaOptions(context: Context): Parameters<typeof normalizeSchema>[1] {
  const options: {
    rootDocument: unknown;
    externalDocuments?: Readonly<Record<string, unknown>>;
    cycleDepth?: number;
  } = { rootDocument: context.document };

  if (Object.keys(context.externalDocuments).length > 0) {
    options.externalDocuments = context.externalDocuments;
  }
  if (context.cycleDepth !== undefined) options.cycleDepth = context.cycleDepth;

  return options;
}

/**
 * Resolves a schema at a use site to a slot.
 *
 * A reference into `components/schemas` becomes a named slot, so the schema is stored once and
 * referred to everywhere. Anything else is normalized in place under a deterministic id.
 */
function schemaSlot(raw: unknown, context: Context, id: string): IRSchemaSlot | undefined {
  if (raw === undefined) return undefined;

  if (isPlainObject(raw)) {
    const reference = asString(raw.$ref);
    if (reference !== undefined && Object.keys(raw).length === 1) {
      const name = schemaNameFromReference(reference);
      if (reference.startsWith('#/components/schemas/') && context.namedSchemas.has(name)) {
        return { kind: 'named', schemaId: name };
      }
    }
  }

  return {
    kind: 'inline',
    schema: buildSchema({
      id,
      payload: raw,
      defaultDialect: context.dialect,
      normalizeOptions: schemaOptions(context),
    }),
  };
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

function readExtensions(source: Record<string, unknown>): Record<string, IRJsonValue> | undefined {
  const extensions: Record<string, IRJsonValue> = {};

  for (const key of Object.keys(source).sort(compareByCodePoint)) {
    if (!key.startsWith('x-')) continue;
    const value = asJsonValue(source[key]);
    if (value !== undefined) extensions[key] = value;
  }

  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

function readInfo(raw: unknown): IRInfo {
  if (!isPlainObject(raw)) throw invalid('the document has no info object');

  const title = asString(raw.title);
  const version = asString(raw.version);
  if (title === undefined || version === undefined) {
    throw invalid('info requires both a title and a version');
  }

  const info: { -readonly [Key in keyof IRInfo]: IRInfo[Key] } = { title, version };

  const summary = asString(raw.summary);
  const description = asString(raw.description);
  const terms = asString(raw.termsOfService);
  if (summary !== undefined) info.summary = summary;
  if (description !== undefined) info.description = description;
  if (terms !== undefined) info.termsOfService = terms;

  if (isPlainObject(raw.contact)) {
    const contact: { -readonly [Key in keyof IRContact]: IRContact[Key] } = {};
    const name = asString(raw.contact.name);
    const url = asString(raw.contact.url);
    const email = asString(raw.contact.email);
    if (name !== undefined) contact.name = name;
    if (url !== undefined) contact.url = url;
    if (email !== undefined) contact.email = email;
    if (Object.keys(contact).length > 0) info.contact = contact;
  }

  if (isPlainObject(raw.license)) {
    const name = asString(raw.license.name);
    if (name !== undefined) {
      const license: { -readonly [Key in keyof IRLicense]: IRLicense[Key] } = { name };
      const identifier = asString(raw.license.identifier);
      const url = asString(raw.license.url);
      if (identifier !== undefined) license.identifier = identifier;
      if (url !== undefined) license.url = url;
      info.license = license;
    }
  }

  return info;
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

    if (isPlainObject(entry.variables)) {
      const variables: Record<string, IRServerVariable> = {};
      for (const name of Object.keys(entry.variables).sort(compareByCodePoint)) {
        const source = entry.variables[name];
        if (!isPlainObject(source)) continue;
        const fallback = asString(source.default);
        if (fallback === undefined) continue;

        const variable: { -readonly [Key in keyof IRServerVariable]: IRServerVariable[Key] } = {
          default: fallback,
        };
        const allowed = asStringArray(source.enum);
        const description2 = asString(source.description);
        if (allowed !== undefined && allowed.length > 0) variable.enum = allowed;
        if (description2 !== undefined) variable.description = description2;
        variables[name] = variable;
      }
      if (Object.keys(variables).length > 0) server.variables = variables;
    }

    servers.push(server);
  }

  return servers;
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
  if (authorizationUrl !== undefined) flow.authorizationUrl = authorizationUrl;
  if (tokenUrl !== undefined) flow.tokenUrl = tokenUrl;
  if (refreshUrl !== undefined) flow.refreshUrl = refreshUrl;

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
      if (implicit !== undefined) flows.implicit = implicit;
      if (password !== undefined) flows.password = password;
      if (clientCredentials !== undefined) flows.clientCredentials = clientCredentials;
      if (authorizationCode !== undefined) flows.authorizationCode = authorizationCode;
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

    if (slot !== undefined) entry.schema = slot;
    if (example !== undefined) entry.example = example;
    if (examples !== undefined) entry.examples = examples;

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
  if (!isPlainObject(raw)) return [];

  const operations: RawOperation[] = [];

  for (const path of Object.keys(raw).sort(compareByCodePoint)) {
    const pathItem = raw[path];
    if (!isPlainObject(pathItem)) continue;

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

  return operations;
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

  if (summary !== undefined) operation.summary = summary;
  if (description !== undefined) operation.description = description;
  if (body !== undefined) operation.requestBody = body;
  if (extensions !== undefined) operation.extensions = extensions;

  return operation;
}

function readTags(raw: unknown): NavigationTag[] {
  if (!isUnknownArray(raw)) return [];

  const tags: NavigationTag[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const name = asString(entry.name);
    if (name === undefined) continue;

    const tag: { -readonly [Key in keyof NavigationTag]: NavigationTag[Key] } = { name };
    const summary = asString(entry.summary);
    const parent = asString(entry.parent);
    if (summary !== undefined) tag.summary = summary;
    if (parent !== undefined) tag.parent = parent;

    tags.push(tag);
  }

  return tags;
}

function readNamedSchemas(context: Context): IRSchema[] {
  const components = context.document.components;
  const source = isPlainObject(components) ? components.schemas : undefined;
  if (!isPlainObject(source)) return [];

  return Object.keys(source)
    .sort(compareByCodePoint)
    .map((name) =>
      buildSchema({
        id: name,
        name,
        payload: { $ref: `#/components/schemas/${name}` },
        defaultDialect: context.dialect,
        normalizeOptions: schemaOptions(context),
      }),
    );
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
    throw invalid('the document has no openapi version field');
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
  if (!isPlainObject(input)) throw invalid('the document is not an object');

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
    documentSecurity: readSecurityRequirements(input.security),
  };

  const info = readInfo(input.info);
  const schemas = readNamedSchemas(context);

  const rawOperations = collectOperations(input.paths);
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
    id: options.documentId ?? slug(info.title),
    kind: 'http',
    hash: '',
    info,
    servers: readServers(input.servers),
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

  return { ...document, hash: hash({ ...document, hash: '' }) };
}

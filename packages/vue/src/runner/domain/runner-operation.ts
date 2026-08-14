/**
 * From an IR operation to the description a runner can send.
 *
 * ONE DERIVATION, TWO CONSUMERS. A theme reaches it through `useRunner`, which has the whole
 * document in state; the renderer calls it while building a page model, so the console works on
 * a page that carries no IR. Two derivations would be two answers to "which server does this
 * operation use", and the second would be found by a reader whose request went somewhere else.
 */

import { compareByCodePoint, generateExample, unsendableSchemeCause } from '@openref/core';
import type {
  IRDocument,
  IRJsonSchema,
  IRJsonValue,
  IRMediaType,
  IROAuthFlows,
  IRParameter,
} from '@openref/core';
import type { IROperation } from '@openref/core';
import { orderedParameters, resolveSchemaSlot } from '../../state/domain/node-view';
import type {
  RunnerBodyEditor,
  RunnerBodyFieldView,
  RunnerBodyMediaTypeView,
  RunnerOAuthFlowKind,
  RunnerOAuthFlowView,
  RunnerOperationView,
  RunnerParameterView,
  RunnerSecuritySchemeView,
  RunnerStreamView,
  RunnerValueKind,
  StreamItemSchemaView,
} from '../application/ports/runner.port';

/**
 * Which cell of the SPEC 14.2 matrix a parameter's values land in.
 *
 * READ FROM THE DECLARED SCHEMA, AND `primitive` WHEN THERE IS NONE. A parameter with no schema
 * is one the document said nothing about, and the honest default is the kind that renders as
 * itself at every style: guessing `object` for it would put a reader's plain value through
 * `deepObject` and send something the document never described.
 *
 * A UNION OR A COMPOSITION RESOLVES TO `primitive` TOO, deliberately. `oneOf: [string, array]`
 * has two answers and this function returns one, so it returns the one that cannot invent
 * structure; the reader still gets a field they can type into, and the request is what they typed.
 *
 * @param parameter - The parameter as the IR carries it
 * @param document - The document, for a schema the parameter names rather than inlines
 * @returns The kind the console offers a field for and the matrix renders
 */
function valueKindOf(parameter: IRParameter, document: IRDocument): RunnerValueKind {
  if (parameter.schema === undefined) return 'primitive';

  const body: IRJsonSchema | undefined = resolveSchemaSlot(
    parameter.schema,
    document.schemas,
  )?.normalized;
  if (body === undefined) return 'primitive';

  const type = body.type;
  const declared = typeof type === 'string' ? [type] : (type ?? []);

  if (declared.includes('array')) return 'array';
  if (declared.includes('object') || body.properties !== undefined) return 'object';

  return 'primitive';
}

function parameterView(parameter: IRParameter, document: IRDocument): RunnerParameterView {
  return {
    name: parameter.name,
    in: parameter.in,
    required: parameter.required,
    style: parameter.style,
    explode: parameter.explode,
    ...(parameter.allowReserved === undefined ? {} : { allowReserved: parameter.allowReserved }),
    ...(parameter.allowEmptyValue === undefined
      ? {}
      : { allowEmptyValue: parameter.allowEmptyValue }),
    valueKind: valueKindOf(parameter, document),
  };
}

/** Whether a media type carries named fields rather than one value. */
function isFieldMediaType(mediaType: string): boolean {
  const type = mediaType.trim().toLowerCase();

  return type.startsWith('multipart/') || type.startsWith('application/x-www-form-urlencoded');
}

/**
 * Whether a media type is text a reader can be asked to type, by the rule SPEC 14.3 states.
 *
 * THE `x-` PREFIX IS PART OF THE RULE AND WAS LEFT OUT OF THE FIRST VERSION, which classed
 * `application/x-ndjson` as bytes and offered a file picker for one of the six forms the task is
 * about. The subtype is matched with an optional `x-` and an optional structured suffix, so
 * `application/x-ndjson` and `application/vnd.acme+json` both land where they belong.
 */
function isTextMediaType(mediaType: string): boolean {
  const type = mediaType.trim().toLowerCase();

  if (type.startsWith('text/')) return true;

  return /^application\/(?:x-)?(?:[\w.-]+\+)?(?:json|ndjson|xml|yaml|graphql)\b/.test(type);
}

/** Follows a property that is a reference, so a named schema's type is readable here. */
function bodyOf(schema: IRJsonSchema, document: IRDocument): IRJsonSchema {
  if (schema.$ref === undefined) return schema;

  return document.schemas.get(schema.$ref)?.normalized ?? schema;
}

/** Whether a schema declares bytes rather than characters. */
function isBinarySchema(schema: IRJsonSchema): boolean {
  const type = schema.type;
  const declared = typeof type === 'string' ? [type] : (type ?? []);

  // `format: binary` IS THE ONE MARKER THE IR CARRIES. OpenAPI 3.1 says the same thing with
  // `contentEncoding` and `contentMediaType`, which the normalizer does not model yet; a document
  // written that way gets a text field, which is a smaller wrong answer than a file picker on a
  // property that is a string.
  return declared.includes('string') && (schema.format ?? '') === 'binary';
}

/**
 * The content type one part of a multipart body carries, by OpenAPI's own default rule.
 *
 * Stated in the specification and worth having here rather than in three themes: a binary string
 * is an octet stream, an object is JSON, an array takes its item's answer, and everything else is
 * plain text. THIS IS WHAT MAKES A JSON PART BESIDE A FILE PART WORK WITHOUT AN `encoding` BLOCK,
 * which most documents do not write.
 */
function defaultPartContentType(schema: IRJsonSchema, document: IRDocument): string {
  const body = bodyOf(schema, document);
  if (isBinarySchema(body)) return 'application/octet-stream';

  const type = body.type;
  const declared = typeof type === 'string' ? [type] : (type ?? []);

  if (declared.includes('object') || body.properties !== undefined) return 'application/json';
  if (declared.includes('array')) {
    return body.items === undefined ? 'text/plain' : defaultPartContentType(body.items, document);
  }

  return 'text/plain';
}

/**
 * The fields a form body is made of, from the properties its schema declares.
 *
 * A FORM WITH NO DECLARED PROPERTIES GETS NO FIELDS AND THEREFORE NO EDITOR TO SPEAK OF, which is
 * the honest answer rather than an empty text box: the console cannot invent field names, and a
 * body of unnamed fields is not something a reader can be asked for. The panel says so.
 */
function bodyFields(media: IRMediaType, document: IRDocument): readonly RunnerBodyFieldView[] {
  const slot = media.schema;
  const schema =
    slot === undefined ? undefined : resolveSchemaSlot(slot, document.schemas)?.normalized;
  const properties = schema?.properties;
  if (schema === undefined || properties === undefined) return [];

  const required = new Set(schema.required ?? []);
  const multipart = media.mediaType.trim().toLowerCase().startsWith('multipart/');

  return Object.entries(properties).map(([name, property]) => {
    const declared = media.encoding?.[name]?.contentType;
    const contentType = multipart
      ? (declared ?? defaultPartContentType(property, document))
      : declared;

    return {
      name,
      required: required.has(name),
      kind: isBinarySchema(bodyOf(property, document)) ? ('file' as const) : ('text' as const),
      ...(contentType === undefined ? {} : { contentType }),
    };
  });
}

/**
 * Which of the three editors of SPEC 14.3 a media type is filled in with.
 *
 * THE MEDIA TYPE DECIDES FIRST AND THE SCHEMA SECOND, and the order matters at exactly one point:
 * `multipart/form-data` whose schema is a binary string is still a form, because the parts are
 * what multipart means. Everywhere else the schema wins over the name, so a vendor media type
 * whose schema says `format: binary` gets a file picker without this file having heard of it.
 */
function editorFor(media: IRMediaType, document: IRDocument): RunnerBodyEditor {
  if (isFieldMediaType(media.mediaType)) return 'fields';

  const slot = media.schema;
  const schema =
    slot === undefined ? undefined : resolveSchemaSlot(slot, document.schemas)?.normalized;

  if (schema !== undefined && isBinarySchema(schema)) return 'binary';
  if (isTextMediaType(media.mediaType)) return 'text';

  // AN UNNAMED TYPE WITH NO SCHEMA IS BYTES, which is the only editor that can express any of
  // them. A textarea there would ask a reader to type a PNG.
  return 'binary';
}

/** Media types the generated example speaks, the page model's own test. */
const JSON_MEDIA_TYPE = /^application\/(?:[\w.+-]+\+)?json$/i;

/**
 * The example the document declared on this media type, if it declared one.
 *
 * `example` wins over the `examples` map, OpenAPI's own precedence, and a map contributes its
 * first member by code point, the same rule the page model applies: a deterministic prefill
 * cannot depend on the order a document happened to list them in.
 */
function declaredExample(media: IRMediaType): IRJsonValue | undefined {
  if (media.example !== undefined) return media.example;
  if (media.examples === undefined) return undefined;

  const first = Object.keys(media.examples).sort(compareByCodePoint)[0];
  return first === undefined ? undefined : media.examples[first]?.value;
}

/**
 * What the text editor arrives prefilled with, per `TX-PARITY-UI` and SPEC 5.5's precedence:
 * the declared example first, the generated one second, and nothing when neither exists.
 *
 * A declared string under a non JSON media type is the text itself; everything else prints as
 * the JSON it would be on the wire. Generation happens only for JSON, because a generated
 * value for `text/csv` would be JSON pretending to be the media type beside it.
 */
function exampleTextOf(media: IRMediaType, document: IRDocument): string | undefined {
  const declared = declaredExample(media);
  const json = JSON_MEDIA_TYPE.test(media.mediaType);

  if (declared !== undefined) {
    return !json && typeof declared === 'string' ? declared : JSON.stringify(declared, null, 2);
  }

  if (!json || media.schema === undefined) return undefined;

  const schema = resolveSchemaSlot(media.schema, document.schemas)?.normalized;
  if (schema === undefined) return undefined;

  const bodies = new Map<string, IRJsonSchema>();
  for (const [id, entry] of document.schemas) {
    if (entry.normalized !== undefined) bodies.set(id, entry.normalized);
  }

  return JSON.stringify(generateExample(schema, { schemas: bodies, view: 'request' }), null, 2);
}

function bodyView(media: IRMediaType, document: IRDocument): RunnerBodyMediaTypeView {
  const editor = editorFor(media, document);
  const exampleText = editor === 'text' ? exampleTextOf(media, document) : undefined;

  return {
    mediaType: media.mediaType,
    editor,
    fields: editor === 'fields' ? bodyFields(media, document) : [],
    ...(exampleText === undefined ? {} : { exampleText }),
  };
}

/**
 * The flows a scheme declares, as a list rather than as four optional members.
 *
 * IN THE ORDER SPEC 14.4 LISTS THEM AND NOT THE DOCUMENT'S, because the IR carries a record and a
 * record has no order worth honouring. The console offers the first that it can run, so the order
 * is behaviour: the authorization code flow, which is the one with PKCE on it, comes first.
 */
function flowViews(flows: IROAuthFlows | undefined): readonly RunnerOAuthFlowView[] {
  if (flows === undefined) return [];

  const kinds: readonly RunnerOAuthFlowKind[] = [
    'authorizationCode',
    'deviceAuthorization',
    'clientCredentials',
    'password',
    'implicit',
  ];

  return kinds.flatMap((kind) => {
    const flow = flows[kind];
    if (flow === undefined) return [];

    return [
      {
        kind,
        ...(flow.authorizationUrl === undefined ? {} : { authorizationUrl: flow.authorizationUrl }),
        ...(flow.tokenUrl === undefined ? {} : { tokenUrl: flow.tokenUrl }),
        ...(flow.refreshUrl === undefined ? {} : { refreshUrl: flow.refreshUrl }),
        ...(flow.deviceAuthorizationUrl === undefined
          ? {}
          : { deviceAuthorizationUrl: flow.deviceAuthorizationUrl }),
        scopes: Object.keys(flow.scopes),
      },
    ];
  });
}

function securityViews(
  operation: IROperation,
  document: IRDocument,
): readonly RunnerSecuritySchemeView[] {
  const schemes = new Map(document.security.map((scheme) => [scheme.id, scheme]));
  const views: RunnerSecuritySchemeView[] = [];
  const seen = new Set<string>();

  for (const requirement of operation.security) {
    if (seen.has(requirement.schemeId)) continue;
    seen.add(requirement.schemeId);

    const scheme = schemes.get(requirement.schemeId);
    // A requirement naming a scheme the document never declared is dropped rather than carried
    // as a nameless credential field. The drift rules of SPEC 7.1 are what report it; a console
    // that showed a field for it would be asking the reader to fill in a scheme nobody defined.
    if (scheme === undefined) continue;

    const unsendable = unsendableSchemeCause(scheme);

    views.push({
      id: scheme.id,
      type: scheme.type,
      ...(scheme.in === undefined ? {} : { in: scheme.in }),
      ...(scheme.name === undefined ? {} : { name: scheme.name }),
      ...(scheme.scheme === undefined ? {} : { scheme: scheme.scheme }),
      flows: flowViews(scheme.flows),
      ...(scheme.openIdConnectUrl === undefined
        ? {}
        : { openIdConnectUrl: scheme.openIdConnectUrl }),
      ...(unsendable === undefined ? {} : { unsendableCause: unsendable }),
    });
  }

  return views;
}

/**
 * Projects one operation into what a runner needs to send it.
 *
 * @param operation - The operation as the IR carries it
 * @param document - The document it belongs to, for servers and security schemes
 * @returns A plain JSON description of the request that can be built for it
 *
 * @example
 * const run = runnerOperationOf(operation, document);
 */
export function runnerOperationOf(
  operation: IROperation,
  document: IRDocument,
): RunnerOperationView {
  const overrides = operation.servers.map((server) => server.url);
  const servers = overrides.length > 0 ? overrides : document.servers.map((server) => server.url);
  const stream = streamView(operation, document);

  return {
    nodeId: operation.id,
    method: operation.method,
    path: operation.path,
    // GROUPED BY LOCATION, WHICH IS THE ORDER THE PARAMETER TABLE ALREADY USED. `orderedParameters`
    // is the one place that order is written, so the table a reader reads and the form they fill
    // cannot come to disagree again.
    parameters: orderedParameters(operation.parameters).map((parameter) =>
      parameterView(parameter, document),
    ),
    servers,
    security: securityViews(operation, document),
    body: (operation.requestBody?.content ?? []).map((media) => bodyView(media, document)),
    ...(stream === undefined ? {} : { stream }),
  };
}

/**
 * What it takes to watch a streaming operation, or undefined when it is not one.
 *
 * THE TRANSPORT IS THE APPLICATION'S ANSWER AND THE FORMAT IS THIS FUNCTION'S. `IRStreamTransport`
 * says how the endpoint streams, and only two of its three values are a body a console can read
 * as it arrives: `sse` is the event stream format and `chunked` is NDJSON. A `websocket` endpoint
 * is not opened with a request at all, so it produces nothing here and waits for SPEC 14.7.
 *
 * THE ITEM SCHEMA IS REDUCED RATHER THAN CARRIED WHOLE, to the keywords SPEC 14.6 says are
 * checked. A projection carrying the full normalized schema would put a schema body into every
 * page with a streaming operation on it, to feed a check that reads five of its keywords.
 *
 * @param operation - The operation, with whatever the collectors found
 * @param document - The document, for resolving a named item schema
 * @returns The view, or undefined when this operation is not a readable stream
 */
function streamView(operation: IROperation, document: IRDocument): RunnerStreamView | undefined {
  const streaming = operation.runtime?.streaming?.value;
  if (streaming === undefined) return undefined;
  if (streaming.transport === 'websocket') return undefined;

  const resolved =
    streaming.itemSchema === undefined
      ? undefined
      : resolveSchemaSlot(streaming.itemSchema, document.schemas)?.normalized;

  return {
    format: streaming.transport === 'sse' ? 'sse' : 'ndjson',
    ...(streaming.terminator === undefined ? {} : { terminator: streaming.terminator }),
    ...(resolved === undefined ? {} : { itemSchema: itemSchemaView(resolved) }),
  };
}

/**
 * Reduces a normalized schema to the keywords the bounded check of SPEC 14.6 reads.
 *
 * ONE LEVEL OF PROPERTIES AND NO DEEPER, which is the same bound the check itself has. A
 * projection that went deeper would ship what nothing reads.
 *
 * @param schema - The normalized schema
 * @returns The reduced view
 */
function itemSchemaView(schema: IRJsonSchema): StreamItemSchemaView {
  const properties: Record<string, StreamItemSchemaView> = {};

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (property.type === undefined) continue;
    properties[name] = { type: property.type };
  }

  return {
    ...(schema.type === undefined ? {} : { type: schema.type }),
    ...(schema.required === undefined ? {} : { required: schema.required }),
    ...(schema.enum === undefined ? {} : { enum: schema.enum }),
    ...(schema.const === undefined ? {} : { const: schema.const }),
    ...(Object.keys(properties).length === 0 ? {} : { properties }),
  };
}

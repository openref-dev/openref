/**
 * The view model one page is rendered from.
 *
 * Everything expensive and everything server only happens here: markdown is turned into
 * sanitized HTML, code is highlighted, examples are generated. What comes out is plain
 * JSON, which is what makes the same model serve both the server render and the client
 * hydration without shipping `marked`, `isomorphic-dompurify` or `shiki` to the browser.
 *
 * A model is a pure function of the document, the node id and the renderer. That is what
 * lets the result be cached by document hash, per SPEC 12.
 */

import {
  generateExample,
  type IRDocument,
  type IRJsonSchema,
  type IRMediaType,
  type IRNavNode,
  type IROperation,
  type IRParameter,
  type IRSchema,
  type IRSchemaSlot,
  type IRSchemaView,
} from '@openref/core';
import {
  materializeNode,
  resolveSchemaSlot,
  runnerOperationOf,
  schemaDisplayName,
} from '@openref/vue';
import type {
  CodeSampleModel,
  MediaTypeModel,
  NavEntryModel,
  NodeModel,
  PageModel,
  ParameterModel,
  ResponseModel,
  SchemaPageModel,
} from '@openref/vue';
import { sliceNavigation } from './nav-payload';
import { buildHealthModel, buildRuntimeModel } from './runtime-model';
import { buildSchemaPayload } from './schema-payload';
import type { IMarkdownRenderer } from '../../markdown/domain/markdown';

/**
 * Version of the page model shape, part of the cache key.
 *
 * 9 SINCE T033: `proxyPath`, the same origin proxy endpoint of SPEC 14.5, optional and absent
 * when the host serves no proxy. It is the fact the runner factory reads to choose the proxy
 * transport, per the T033 amendment: the server knows whether the proxy is mounted and the
 * browser cannot, so the page carries the fact, about 27 bytes where a host has one and none
 * where it does not. A page cached before this serves a console that sends directly on a host
 * whose proxy is up, which is the defence existing and not being offered.
 *
 * 8 SINCE `TX-SLOTWIRE`. Two changes, and both are about what a slot can be handed. A runtime
 * value carries `confidence` and `collector` where it carried `code`, `markClass` and
 * `markTitle`, because `ProvenanceTag` is declared in terms of the two facts and not of the three
 * strings the reference draws from them; and a node carries `codeSamples`, per SPEC 18. A page
 * cached before that draws a runtime block with no provenance marks at all, which is the half of
 * SPEC 6.1 a reader uses to decide how much to trust a row.
 *
 * 7 WAS T028. Every scheme in `run.security` now carries the flows it declares and, for the two
 * a browser cannot send, the sentence saying why. A page cached before that draws a console with
 * no sign in for an `oauth2` scheme and, worse, nothing at all where `mutualTLS` should say what
 * it needs, which is the failure the field was added to prevent.
 *
 * 6 was T027: `run.bodyMediaTypes`, a list of strings, became `run.body`, a list of media types
 * each carrying the editor its schema asks for and the fields it is made of.
 */
export const PAGE_MODEL_VERSION = 9;

/** Media types an example is generated for. */
const JSON_MEDIA_TYPE = /^application\/(?:[\w.+-]+\+)?json$/i;

/**
 * THE SHAPES THIS BUILDS LIVE IN `@openref/vue`, since `TX-SLOTWIRE`.
 *
 * `PageModel` and everything under it is the projection a theme is handed, and the slot contract
 * is declared in terms of it, so it belongs to the package a theme is written against. The
 * building stays here, because it needs markdown, a sanitizer, a highlighter and the example
 * generator, and none of those may cross into the headless layer. Both are re-exported from this
 * package's index, so nothing that used them had to move.
 */

/** What building a page model needs. */
export interface PageModelOptions {
  /** Node to show, or null for the document overview. */
  readonly nodeId?: string | null;
  /** Named schema to show, for a schema page. Ignored when `nodeId` is set. */
  readonly schemaId?: string | null;
  readonly markdown: IMarkdownRenderer;
  /** Where the reference is mounted, so the client can build the links the server built. */
  readonly basePath?: string;
  /** Greatest serialized size of the schema payload. Defaults to the measured limit. */
  readonly schemaPayloadLimit?: number;
  /**
   * The same origin proxy endpoint, when the host mounted one, per SPEC 14.5.
   *
   * Only the server knows, so it enters the model here or the browser never learns it.
   */
  readonly proxyPath?: string;
}

/**
 * What every step of the build shares.
 *
 * `schemaBodies` exists because the document keeps `IRSchema` wrappers while the example
 * generator follows `$ref` through bodies. Deriving it once per page rather than per
 * position keeps a document with a thousand schemas from rebuilding the map per parameter.
 */
interface ModelContext {
  readonly document: IRDocument;
  readonly markdown: IMarkdownRenderer;
  readonly schemaBodies: ReadonlyMap<string, IRJsonSchema>;
  /** Mount point, which a finding's jump to its subject is built from. */
  readonly basePath: string;
}

function schemaBodiesOf(document: IRDocument): ReadonlyMap<string, IRJsonSchema> {
  const bodies = new Map<string, IRJsonSchema>();

  for (const [id, schema] of document.schemas) {
    if (schema.normalized !== undefined) bodies.set(id, schema.normalized);
  }

  return bodies;
}

function navHint(document: IRDocument, nodeId: string | undefined): string {
  if (nodeId === undefined) return '';

  const node = document.nodes.get(nodeId);
  if (node === undefined) return '';
  if (node.kind === 'channel') return node.address ?? '';

  return `${node.method.toUpperCase()} ${node.path}`;
}

function navEntry(document: IRDocument, node: IRNavNode): NavEntryModel {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    nodeId: node.nodeId ?? null,
    schemaId: node.schemaId ?? null,
    deprecated: node.deprecated ?? false,
    hint: navHint(document, node.nodeId),
    childCount: node.children.length,
    children: node.children.map((child) => navEntry(document, child)),
  };
}

/**
 * The whole navigation of a document, as the model carries it.
 *
 * Separate from `buildPageModel` because it is separately served: a page ships a slice of this
 * and the rest arrives from `<mount>/_navigation/<hash>` when a reader opens a closed group or
 * the palette. One function builds both, so the two can never describe different documents.
 *
 * @param document - The normalized document
 * @returns Every navigation entry, in tree shape
 */
export function buildNavigation(document: IRDocument): NavEntryModel[] {
  return document.navigation.map((entry) => navEntry(document, entry));
}

/**
 * Names the type at a use site in one short string.
 *
 * A named schema shows its name, without the identity suffix an external target carries.
 * An anonymous one shows its JSON Schema type. The full structure is the schema viewer's
 * job, in T012; this is the one line that sits next to a parameter name.
 *
 * @param slot - Schema slot, or undefined when the position declares no schema
 * @param schemas - The document's schema map
 * @returns A short label, empty when nothing is declared
 */
export function typeLabel(
  slot: IRSchemaSlot | undefined,
  schemas: ReadonlyMap<string, IRSchema>,
): string {
  if (slot === undefined) return '';

  if (slot.kind === 'named') {
    return schemaDisplayName(schemas.get(slot.schemaId), slot.schemaId);
  }

  const body = slot.schema.normalized;
  if (body === undefined) return schemaDisplayName(slot.schema, slot.schema.id);

  if (body.$ref !== undefined) {
    return schemaDisplayName(schemas.get(body.$ref), body.$ref);
  }

  return jsonSchemaTypeLabel(body);
}

function jsonSchemaTypeLabel(body: IRJsonSchema): string {
  if (body.title !== undefined && body.title !== '') return body.title;
  if (body.$cycle !== undefined) return `${body.$cycle} (cycle)`;
  if (body.enum !== undefined) return 'enum';
  if (body.type === undefined) return 'any';

  return typeof body.type === 'string' ? body.type : body.type.join(' | ');
}

function exampleHtml(media: IRMediaType, context: ModelContext, view: IRSchemaView): string {
  if (!JSON_MEDIA_TYPE.test(media.mediaType)) return '';
  if (media.schema === undefined) return '';

  const schema = resolveSchemaSlot(media.schema, context.document.schemas);
  if (schema?.normalized === undefined) return '';

  const value = generateExample(schema.normalized, { schemas: context.schemaBodies, view });
  return context.markdown.renderCode(`${JSON.stringify(value, null, 2)}\n`, 'json');
}

function mediaTypeModel(
  media: IRMediaType,
  context: ModelContext,
  view: IRSchemaView,
): MediaTypeModel {
  return {
    mediaType: media.mediaType,
    typeLabel: typeLabel(media.schema, context.document.schemas),
    exampleHtml: exampleHtml(media, context, view),
    schema: media.schema ?? null,
    view,
  };
}

/**
 * Call samples of an operation, highlighted here rather than in the browser.
 *
 * SAME RULE AS EVERY OTHER BLOCK OF CODE ON A PAGE, per SPEC 12: the highlighter is 300 KB and
 * stays on the server, so what travels is the markup it produced. A sample in a language the
 * highlighter does not know renders as plain text, which is what `renderCode` already does for
 * a fenced block in an unknown language.
 *
 * @param node - The operation
 * @param context - The markdown renderer, which owns the highlighter
 * @returns One entry per sample the document wrote
 */
function codeSampleModels(node: IROperation, context: ModelContext): CodeSampleModel[] {
  return (node.codeSamples ?? []).map((sample) => ({
    lang: sample.lang,
    label: sample.label,
    sourceHtml: context.markdown.renderCode(sample.source, sample.lang),
  }));
}

function parameterModel(parameter: IRParameter, context: ModelContext): ParameterModel {
  return {
    name: parameter.name,
    location: parameter.in,
    required: parameter.required,
    deprecated: parameter.deprecated ?? false,
    typeLabel: typeLabel(parameter.schema, context.document.schemas),
    descriptionHtml: context.markdown.render(parameter.description),
    schema: parameter.schema ?? null,
  };
}

/** Every use site on a node page, which is what the schema payload is seeded from. */
function slotsOf(node: NodeModel): IRSchemaSlot[] {
  const slots: IRSchemaSlot[] = [];

  for (const parameter of node.parameters)
    if (parameter.schema !== null) slots.push(parameter.schema);
  for (const media of node.requestBody) if (media.schema !== null) slots.push(media.schema);
  for (const response of node.responses) {
    for (const media of response.content) if (media.schema !== null) slots.push(media.schema);
  }

  return slots;
}

function schemaPageModel(context: ModelContext, schemaId: string): SchemaPageModel {
  const entry = context.document.schemas.get(schemaId);

  if (entry === undefined) {
    return {
      id: schemaId,
      name: schemaDisplayName(undefined, schemaId),
      descriptionHtml: '',
      deprecated: false,
      missing: true,
    };
  }

  const body = entry.normalized;

  return {
    id: schemaId,
    name: schemaDisplayName(entry, schemaId),
    descriptionHtml: context.markdown.render(body?.description),
    deprecated: body?.deprecated ?? false,
    missing: false,
  };
}

function nodeModel(context: ModelContext, nodeId: string): NodeModel | null {
  const { document, markdown } = context;
  const node = document.nodes.get(nodeId);
  if (node === undefined) return null;

  const view = materializeNode(node, document);

  const base = {
    id: view.id,
    kind: view.kind,
    title: view.title,
    deprecated: view.deprecated,
    tags: node.tags,
    summary: node.summary ?? '',
    descriptionHtml: markdown.render(node.description),
  };

  const runtime = buildRuntimeModel(document, nodeId, context.basePath);

  if (view.kind === 'channel') {
    return {
      ...base,
      method: null,
      path: null,
      address: view.node.address ?? null,
      parameters: [],
      requestBody: [],
      responses: [],
      security: [],
      codeSamples: [],
      run: null,
      runtime,
    };
  }

  const parameters = [...view.parameters.values()]
    .flat()
    .map((parameter) => parameterModel(parameter, context));

  return {
    ...base,
    method: view.node.method.toUpperCase(),
    path: view.node.path,
    address: null,
    parameters,
    requestBody: (view.node.requestBody?.content ?? []).map((media) =>
      mediaTypeModel(media, context, 'request'),
    ),
    responses: view.responses.map((response) => ({
      statusCode: response.statusCode,
      descriptionHtml: markdown.render(response.description),
      content: response.content.map((media) => mediaTypeModel(media, context, 'response')),
    })),
    security: view.security.map((requirement) => ({
      schemeId: requirement.schemeId,
      type: requirement.scheme?.type ?? 'unknown',
      scopes: requirement.scopes,
    })),
    codeSamples: codeSampleModels(view.node, context),
    run: runnerOperationOf(view.node, document),
    runtime,
  };
}

/**
 * Builds the model for one page.
 *
 * An unknown node id produces the overview rather than an error. A reference is served
 * over HTTP and a stale link is a normal event, not a failure of the renderer; the caller
 * decides whether to answer 404, and `PageModel.node` being null is what tells it.
 *
 * @param document - The normalized document
 * @param options - Node to show and the markdown renderer to use
 * @returns A model made only of JSON values
 */
export function buildPageModel(document: IRDocument, options: PageModelOptions): PageModel {
  const { markdown } = options;
  const basePath = options.basePath ?? '';
  const context: ModelContext = {
    document,
    markdown,
    schemaBodies: schemaBodiesOf(document),
    basePath,
  };
  const requestedNode = options.nodeId ?? null;
  const node = requestedNode === null ? null : nodeModel(context, requestedNode);
  const requestedSchema = node === null ? (options.schemaId ?? null) : null;
  const schema = requestedSchema === null ? null : schemaPageModel(context, requestedSchema);

  const slots: IRSchemaSlot[] =
    node !== null
      ? slotsOf(node)
      : schema !== null && !schema.missing
        ? [{ kind: 'named', schemaId: schema.id }]
        : [];

  // THE PANEL TRAVELS WITH THE OVERVIEW AND WITH NOTHING ELSE. A report of four hundred findings
  // shipped on every node page would be the largest thing on a page it is not about, and the
  // pages a reader spends their time on are the node pages.
  const health = node === null && schema === null ? buildHealthModel(document, basePath) : null;

  const payload = buildSchemaPayload(document, slots, options.schemaPayloadLimit);
  const navigation = sliceNavigation(
    buildNavigation(document),
    node === null ? null : node.id,
    schema === null ? null : schema.id,
  );

  return {
    pageModelVersion: PAGE_MODEL_VERSION,
    documentId: document.id,
    documentHash: document.hash,
    title: document.info.title,
    version: document.info.version,
    descriptionHtml: markdown.render(document.info.description),
    basePath,
    ...(options.proxyPath === undefined ? {} : { proxyPath: options.proxyPath }),
    servers: document.servers.map((server) => server.url),
    navigation: navigation.entries,
    navigationComplete: navigation.complete,
    navigationRows: navigation.total,
    activeNodeId: node === null ? null : node.id,
    activeSchemaId: schema === null ? null : schema.id,
    node,
    schema,
    schemas: payload.schemas,
    truncatedSchemas: payload.truncated,
    health,
    healthRendered: health !== null,
  };
}

export type {
  CodeSampleModel,
  MediaTypeModel,
  NavEntryModel,
  NodeModel,
  PageModel,
  ParameterModel,
  ResponseModel,
  SchemaPageModel,
};

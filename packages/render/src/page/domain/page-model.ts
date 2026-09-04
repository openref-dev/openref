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
  buildTopology,
  compareByCodePoint,
  generateExample,
  type IRChannel,
  type IRChannelParameter,
  type IRChannelReply,
  type IRConfidence,
  type IRDocument,
  type IRDriftIssue,
  type IRExample,
  type IRJsonSchema,
  type IRJsonValue,
  type IRMediaType,
  type IRMessage,
  type IRNavNode,
  type IRNodeRuntime,
  type IROperation,
  type IRParameter,
  type IRSchema,
  type IRSchemaDialect,
  type IRSchemaSlot,
  type IRSchemaView,
  type IRSecurityRequirement,
} from '@openref/core';
import {
  materializeNode,
  resolveSchemaSlot,
  runnerOperationOf,
  schemaDisplayName,
} from '@openref/vue';
import type {
  BindingModel,
  ChannelModel,
  ChannelOperationModel,
  ChannelParameterModel,
  ChannelReplyModel,
  ChannelServerModel,
  CodeSampleModel,
  FrameModel,
  FrameStatsModel,
  FrameTabModel,
  MediaTypeModel,
  MessageBodyModel,
  MessageExampleModel,
  MessageModel,
  NavEntryModel,
  NodeModel,
  PageKind,
  PageModel,
  ParameterModel,
  ResponseModel,
  SchemaPageModel,
  SecurityModel,
  ServicePageModel,
  StaticProxyModel,
} from '@openref/vue';
import {
  benchHref,
  healthPageHref,
  nodeHref,
  overviewHref,
  schemaHref,
  shapesHref,
  statesHref,
} from './links';
import { sliceNavigation } from './nav-payload';
import { buildHealthModel, buildRuntimeModel } from './runtime-model';
import { buildSchemaPayload } from './schema-payload';
import type { IMarkdownRenderer } from '../../markdown/domain/markdown';
import { reasonPhrase } from '../../shared/status';

/**
 * Version of the page model shape, part of the cache key.
 *
 * 19 SINCE `T052`: the model carries `topology`, the graph of SPEC 9, a value on an overview
 * whose document declares edges and null on every other page. A page cached before this hydrates
 * an overview article whose client walk finds no graph where the server drew one, which is the
 * page from before the topology had a renderer rather than a broken one, and the version is what
 * keeps a document that declares edges and a client that never heard of them apart.
 *
 * 18 SINCE `T050`: a node carries `channel`, null on every operation and a value on every
 * channel, and `drawn` may hold three marks that did not exist, `channel`, `channel-operations`
 * and `messages`. A page cached before this hydrates a channel article whose client walk finds
 * marks it cannot draw, or draws nothing under the header where the server drew three sections,
 * which is the page from before channels had a renderer rather than a broken one, and the
 * version is what keeps the two from meeting on one screen.
 *
 * 17 SINCE `T046`: the model carries `service`, the federated service card of SPEC 15.3, null on
 * every other page, and every navigation entry carries `serviceId`, null outside the group a
 * merge builds per service. A page cached before this hydrates a rail whose service groups have
 * no card link and no status mark to hang the live snapshot on, which is the page from before
 * federation had a face rather than a broken one, and the version is what keeps a federated
 * page and a pre-federation client from meeting on one screen.
 *
 * 16 SINCE `T042`: the model carries `staticProxy`, the prefix the SPEC 16.2 rewrite rules live
 * under and the upstreams they are pinned to in `u<N>` order, set only by a static build whose
 * target can rewrite routes. It is the fact the runner factory reads to choose the path rewrite
 * transport, exactly as `proxyPath` is for the envelope proxy: the build knows which rules it
 * wrote and the browser cannot, so the page carries the pair. A page cached before this hydrates
 * a console that sends direct on a deployment whose rules are up, which is the T040 generation
 * side existing and never being offered, and the version is what keeps a proxied page and an
 * unproxied client from meeting on one screen.
 *
 * 15 SINCE `T040`: the model carries `directTarget`, the name of a deployment platform that
 * cannot rewrite routes, per SPEC 16.2, set only by a static build for such a target and only
 * when the document pins an absolute upstream. The console reads it to warn that requests go
 * straight from the reader's browser to the API. A page cached before this hydrates a console
 * with no warning, which on a served page is correct and on a static one is the page from
 * before the warning existed rather than a broken one, and the version is what keeps a warned
 * page and an unwarned client from meeting on one screen.
 *
 * 14 SINCE `TX-ADOPT`: a node carries `drawn`, the list of sections the server drew in draw
 * order, and a media type carries `hasExample`, because the client walks the first and adopts
 * the second instead of recomputing conditions over fields the state block no longer ships. A
 * page cached before this hydrates an operation article whose client walk finds no `drawn`
 * and draws nothing under the header, which is the page from before the adoption model rather
 * than a broken one, and the version is what keeps the two from meeting on one screen.
 *
 * 13 SINCE `TX-PARITY-UI`: the frame carries six constant tab kinds, navigation entries and
 * node headers carry `sse`, parameters carry the scan's columns, responses carry the compact
 * row's phrase and schema link while their examples and payload schemas stay behind, and the
 * health model carries the KPI triple and the silent rules. A page cached before this
 * hydrates a bar with hidden tabs and a responses block that re-expands inline, which is the
 * page from before the parity markup landed rather than a broken one.
 *
 * 12 SINCE `TX-MARKUP`: the header promise widened to `tags` and `operationId`, the runtime
 * block carries `responseMarks` and `contracts` for the merged responses and the error grid,
 * and a schema page carries `dialect`. A page cached before this hydrates a header with no
 * kicker and a responses block that says nothing the runtime knows, which is the page from
 * before the markup landed rather than a broken one.
 *
 * 11 SINCE `TX-FRAME`: `kind` and `frame` on the model, `driftCount` on every navigation
 * entry, and the health panel travels with the health page rather than the overview, per
 * SPEC 13.3 and 7.3 as amended 2026-08-14. A page cached before this hydrates a shell with
 * no tab bar data and an overview that still claims the panel, which is the frame from
 * before the layout landed rather than a broken one.
 *
 * 10 SINCE `TX-GUTTER`: `RuntimeModel.parity`, the parity scale of SPEC 6.3, and
 * `DriftModel.code`, the display code of SPEC 7.1's table. A page cached before this hydrates
 * an operation whose runtime block has no scale to adopt and whose findings cite no code,
 * which is the page from before the design landed rather than a broken one, and the version
 * is what keeps the two from being mixed on one screen.
 *
 * 9 SINCE T033: `proxyPath`, the same origin proxy endpoint of SPEC 14.5, optional and absent
 * when the host serves no proxy. It is the fact the runner factory reads to choose the proxy
 * transport, per the T033 amendment: the server knows whether the proxy is mounted and the
 * browser cannot, so the page carries the fact, about 27 bytes where a host has one and none
 * where it does not. A page cached before this serves a console that sends directly on a host
 * whose proxy is up, which is the defence existing and not being offered.
 *
 * 20 SINCE THE MAINTAINER'S TWELVE. A node carries `codeSamplesElsewhere`, the languages SPEC 18
 * generates for this operation that the page did not draw. A page cached before this hydrates
 * against a client that reads the member, and a client reading `undefined` where a list belongs
 * draws no notice at all, so the three languages the page is not carrying would go back to being
 * silently absent, which is the exact state this member exists to end.
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
export const PAGE_MODEL_VERSION = 20;

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
  /**
   * Which page to build, per SPEC 13.3.
   *
   * Absent keeps the pre `TX-FRAME` derivation: a node id means the node page, else a schema
   * id means the schema page, else the overview. `bench` reads `nodeId`, `shapes` reads
   * `schemaId`, `health` and `states` read neither.
   */
  readonly page?: PageKind;
  /** Node to show, or null for the document overview. */
  readonly nodeId?: string | null;
  /** Named schema to show, for a schema page. Ignored when `nodeId` is set. */
  readonly schemaId?: string | null;
  /** Federated service to show, for a service card, per SPEC 15.3. Read only by `service`. */
  readonly serviceId?: string | null;
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
  /**
   * Name of a deployment platform that cannot rewrite routes, per SPEC 16.2.
   *
   * Only the static build knows what it was targeted at, so the fact enters the model here or
   * the console never learns why it is sending directly.
   */
  readonly directTarget?: string;
  /**
   * The generated proxy rules of SPEC 16.2, when the build wrote them, per `T042`.
   *
   * Only the static build knows which rules it wrote and which upstream each one is pinned to,
   * so the pair enters the model here or the console has no rule to address.
   */
  readonly staticProxy?: StaticProxyModel;
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

/** The method of an operation entry, for the rail's badge. Empty for everything else. */
function navMethod(document: IRDocument, nodeId: string | undefined): string {
  if (nodeId === undefined) return '';

  const node = document.nodes.get(nodeId);
  return node === undefined || node.kind === 'channel' ? '' : node.method.toUpperCase();
}

/**
 * Whether an operation's declared responses carry `text/event-stream`, per `TX-PARITY-UI`.
 *
 * THE DOCUMENT DECIDES AND NOT THE RUNTIME FACT, because the badge is drawn on every page of
 * every document, cached by hash, and a runtime-only stream that the document does not declare
 * is the streaming row's drift to report, not a badge to award.
 */
function operationIsSse(document: IRDocument, nodeId: string | undefined): boolean {
  if (nodeId === undefined) return false;

  const node = document.nodes.get(nodeId);
  if (node === undefined || node.kind === 'channel') return false;

  return node.responses.some((response) =>
    response.content.some((media) => media.mediaType === 'text/event-stream'),
  );
}

/**
 * Findings per subject, counted once per document rather than once per entry.
 *
 * Keyed by node id and by schema id in one map, because a navigation entry carries at most one
 * of the two and the report addresses a finding to at most one of the two.
 */
function driftCounts(document: IRDocument): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const issues: readonly IRDriftIssue[] = document.health?.drift ?? [];

  for (const issue of issues) {
    const subject = issue.nodeId ?? issue.schemaId;
    if (subject === undefined) continue;
    counts.set(subject, (counts.get(subject) ?? 0) + 1);
  }

  return counts;
}

function navEntry(
  document: IRDocument,
  node: IRNavNode,
  counts: ReadonlyMap<string, number>,
): NavEntryModel {
  const children = node.children.map((child) => navEntry(document, child, counts));
  const own = counts.get(node.nodeId ?? node.schemaId ?? '') ?? 0;

  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    nodeId: node.nodeId ?? null,
    schemaId: node.schemaId ?? null,
    serviceId: node.serviceId ?? null,
    deprecated: node.deprecated ?? false,
    // A group's count is its children's, so a closed group still says what it holds; an
    // entry that is both a page and a parent, which the tree does not produce today, would
    // still count each finding once because a finding names one subject.
    driftCount: own + children.reduce((sum, child) => sum + child.driftCount, 0),
    hint: navHint(document, node.nodeId),
    method: navMethod(document, node.nodeId),
    sse: operationIsSse(document, node.nodeId),
    childCount: node.children.length,
    children,
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
  const counts = driftCounts(document);
  return document.navigation.map((entry) => navEntry(document, entry, counts));
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

/**
 * The example the document declared on this media type, if it declared one.
 *
 * `example` wins over the `examples` map, which is OpenAPI's own precedence; a map without a
 * plain `example` contributes its first member by code point, because a deterministic page
 * cannot depend on the order a document happened to list them in.
 *
 * @param media - The media type
 * @returns The declared value, or nothing
 */
function declaredMediaExample(media: IRMediaType): IRJsonValue | undefined {
  if (media.example !== undefined) return media.example;
  if (media.examples === undefined) return undefined;

  const first = Object.keys(media.examples).sort(compareByCodePoint)[0];
  return first === undefined ? undefined : media.examples[first]?.value;
}

/**
 * The body block under a media type: the declared example, or a generated one.
 *
 * THE DECLARED EXAMPLE WINS, per SPEC 5.5's 2026-08-14 line, and for any media type rather
 * than only JSON. It is the document's statement about this one response, so it is the only
 * form that can differ between two responses sharing a schema; the generated example is a pure
 * function of the schema and printed the same body under 400 and 429, stating a status neither
 * of them has. The `missing-example` rule's suggested edit adds exactly this field, so before
 * this branch existed the suggestion led to an edit that changed nothing on the page.
 *
 * A declared string under a non JSON media type renders as the text it is, which is what the
 * receipt's `text/csv` example asks for; under a JSON media type every value is printed as the
 * JSON it would be on the wire.
 */
function exampleHtml(media: IRMediaType, context: ModelContext, view: IRSchemaView): string {
  const declared = declaredMediaExample(media);
  const json = JSON_MEDIA_TYPE.test(media.mediaType);

  if (declared !== undefined) {
    const text =
      !json && typeof declared === 'string' ? declared : JSON.stringify(declared, null, 2);
    return context.markdown.renderCode(`${text.replace(/\n$/, '')}\n`, json ? 'json' : '');
  }

  if (!json) return '';
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
  withExample = true,
): MediaTypeModel {
  // A RESPONSE EXAMPLE IS BUILT EMPTY SINCE `TX-PARITY-UI`: the compact index draws the
  // schema link instead of the inline expansion, so the highlighted example would be state
  // bytes on every operation page for markup nothing draws.
  const example = withExample ? exampleHtml(media, context, view) : '';

  return {
    mediaType: media.mediaType,
    typeLabel: typeLabel(media.schema, context.document.schemas),
    exampleHtml: example,
    // The flag is what survives redaction, per `TX-ADOPT`: the example is markup the browser
    // adopts, so the client draws a childless element exactly when the server drew one.
    hasExample: example !== '',
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

/** What the runtime says about one parameter row, in the scan's vocabulary. */
interface ParameterFact {
  readonly runtimeNote: string;
  readonly confidence: IRConfidence | null;
  readonly collector: string;
  readonly unread: boolean;
}

/** The row no fact touches, which is every row of a document-only page. */
const UNTOUCHED_PARAMETER: ParameterFact = {
  runtimeNote: '',
  confidence: null,
  collector: '',
  unread: false,
};

/** The scan's phrase per verdict, per SPEC 6.2.1 and `TX-PARITY-UI`. */
const READ_NOTES = {
  read: 'seen read',
  'not-seen-read': 'not seen read by the handler',
  unaccounted: 'not accounted for by the scan',
} as const;

/**
 * Joins the per parameter runtime facts to the rows the table draws.
 *
 * A HEADER THE `requiredHeaders` FACT NAMES WINS OVER THE SCAN'S VERDICT, the SP010 skip read
 * forwards: the guard reading it is the application reading it, so the note says what the
 * application does with it rather than what the handler was seen to do. Everything else takes
 * the scan's verdict, and a row neither fact touches keeps empty columns, per SPEC 6.3.
 */
function parameterFactsOf(
  runtime: IRNodeRuntime | undefined,
): (parameter: IRParameter) => ParameterFact {
  const headers = runtime?.requiredHeaders;
  const required = new Set((headers?.value ?? []).map((name) => name.toLowerCase()));
  const reads = runtime?.parameterReads;
  const verdicts = new Map(
    (reads?.value.parameters ?? []).map((entry) => [`${entry.in}:${entry.name}`, entry.verdict]),
  );

  return (parameter: IRParameter): ParameterFact => {
    if (
      headers !== undefined &&
      parameter.in === 'header' &&
      required.has(parameter.name.toLowerCase())
    ) {
      return {
        runtimeNote: 'required by the application',
        confidence: headers.confidence,
        collector: headers.collector,
        unread: false,
      };
    }

    const verdict = verdicts.get(`${parameter.in}:${parameter.name}`);
    if (verdict === undefined || reads === undefined) return UNTOUCHED_PARAMETER;

    return {
      runtimeNote: READ_NOTES[verdict],
      confidence: reads.confidence,
      collector: reads.collector,
      unread: verdict === 'not-seen-read',
    };
  };
}

function parameterModel(
  parameter: IRParameter,
  context: ModelContext,
  fact: ParameterFact,
): ParameterModel {
  return {
    name: parameter.name,
    location: parameter.in,
    required: parameter.required,
    deprecated: parameter.deprecated ?? false,
    typeLabel: typeLabel(parameter.schema, context.document.schemas),
    descriptionHtml: context.markdown.render(parameter.description),
    schema: parameter.schema ?? null,
    ...fact,
  };
}

/**
 * Every use site on a node page, which is what the schema payload is seeded from.
 *
 * RESPONSE SLOTS ARE NOT SEEDED SINCE `TX-PARITY-UI`: the compact index links a response's
 * schema to its own page instead of expanding a tree under the code, so shipping the response
 * graphs was state bytes for markup nothing draws. A theme that still draws trees from
 * `content` finds the ids in `truncated` and draws the link, the existing degradation.
 */
function slotsOf(node: NodeModel): IRSchemaSlot[] {
  const slots: IRSchemaSlot[] = [];

  for (const parameter of node.parameters)
    if (parameter.schema !== null) slots.push(parameter.schema);
  for (const media of node.requestBody) if (media.schema !== null) slots.push(media.schema);

  // A CHANNEL SEEDS FROM ITS MESSAGES, per `T050`: the reading rows of a payload resolve their
  // references against the page's bounded payload, exactly as the tree does, so a named schema a
  // message points at either ships or lands in `truncated` and draws the link.
  for (const message of node.channel?.messages ?? []) {
    const payload = message.payload?.schema ?? null;
    const headers = message.headers?.schema ?? null;
    if (payload !== null) slots.push(payload);
    if (headers !== null) slots.push(headers);
  }

  return slots;
}

/**
 * The dialect line of the schema page head, in the reader's words.
 *
 * `unknown` renders as nothing: a page that prints the word unknown about its own schema is
 * reporting on the instrument in the line that exists to state a fact about the document.
 */
const DIALECT_LABELS: Readonly<Record<IRSchemaDialect, string>> = {
  'json-schema-2020-12': 'JSON Schema 2020-12',
  'openapi-3.0': 'OpenAPI 3.0 schema',
  'asyncapi-schema': 'AsyncAPI schema',
  avro: 'Avro',
  protobuf: 'Protobuf',
  unknown: '',
};

/**
 * The blocks of one `bindings` map, in code point order of protocol name, per SPEC 8.2.
 *
 * KEPT VERBATIM AND PRINTED AS SOURCE, because a binding has no analogue and therefore no shape
 * this project may invent: `bindings.kafka` is whatever the Kafka binding specification says, and
 * a model naming its members would be a reading of a specification this normalizer does not read.
 * Highlighted here for the reason every other block of code on a page is, per SPEC 12.
 */
function bindingModels(
  bindings: Readonly<Record<string, IRJsonValue>> | undefined,
  context: ModelContext,
): BindingModel[] {
  if (bindings === undefined) return [];

  return Object.keys(bindings)
    .sort(compareByCodePoint)
    .map((protocol) => ({
      protocol,
      sourceHtml: context.markdown.renderCode(
        `${JSON.stringify(bindings[protocol], null, 2)}\n`,
        'json',
      ),
    }));
}

/**
 * The variables of a templated channel address, per SPEC 8.2 and the maintainer's ruling.
 *
 * THEY ARE NOT PARAMETER ROWS, and the reason is a type rather than a layout: a
 * `ParameterModel.location` is one of OpenAPI's four, and a channel variable is in none of them.
 * An address like `orders/{tenant}` whose variable descriptions were dropped has lost the half
 * that explains the other half, which is why the carrier exists at all.
 */
function channelParameterModels(
  parameters: Readonly<Record<string, IRChannelParameter>> | undefined,
  context: ModelContext,
): ChannelParameterModel[] {
  if (parameters === undefined) return [];

  return Object.keys(parameters)
    .sort(compareByCodePoint)
    .map((name) => {
      const parameter = parameters[name];

      return {
        name,
        descriptionHtml: context.markdown.render(parameter?.description),
        values: parameter?.enum ?? [],
        fallback: parameter?.default ?? '',
        examples: parameter?.examples ?? [],
        location: parameter?.location ?? '',
      };
    });
}

/**
 * The servers a channel is available on, with the protocol each one declares.
 *
 * THE OVERRIDE CARRIES A URL AND THE DOCUMENT CARRIES THE PROTOCOL, so the two are joined here
 * rather than left to a theme: `IRChannel.servers` is a list of `IRServerOverride`, which is a
 * url and a description, and the protocol, the protocol version and the bindings live on the
 * document's own entry for the same url. A url the document does not declare keeps an empty
 * protocol rather than borrowing one, which is the absence rule of SPEC 6.3 applied here.
 */
function channelServerModels(channel: IRChannel, document: IRDocument): ChannelServerModel[] {
  const declared = new Map(document.servers.map((server) => [server.url, server]));

  return channel.servers.map((override) => {
    const server = declared.get(override.url);

    return {
      url: override.url,
      protocol: server?.protocol ?? '',
      protocolVersion: server?.protocolVersion ?? '',
      description: override.description ?? server?.description ?? '',
      security: securityModels(server?.security ?? [], document),
    };
  });
}

/**
 * Requirements with their schemes looked up, the one builder every position uses.
 *
 * ONE FUNCTION FOR THREE POSITIONS, per SPEC 8.2: an HTTP operation names schemes, an event
 * server names schemes, and an event operation names schemes, and all three name the one table in
 * `IRDocument.security`. A scheme a document requires and never declared keeps the requirement and
 * says `unknown`, which is the honest answer and the one the operation page already gave.
 *
 * WHAT IT DOES NOT DO IS INVENT A LOCATION. `in` and `name` come off the scheme or come out empty,
 * so a `plain` or an `X509` requirement draws its type and nothing else.
 *
 * @param requirements - The requirements as the position carries them
 * @param document - The document whose security table resolves them
 * @returns One model per requirement, in the order the position wrote them
 */
function securityModels(
  requirements: readonly IRSecurityRequirement[],
  document: IRDocument,
): SecurityModel[] {
  const schemes = new Map(document.security.map((scheme) => [scheme.id, scheme]));

  return requirements.map((requirement) => {
    const scheme = schemes.get(requirement.schemeId);

    return {
      schemeId: requirement.schemeId,
      type: scheme?.type ?? 'unknown',
      in: scheme?.in ?? '',
      name: scheme?.name ?? '',
      scopes: requirement.scopes,
    };
  });
}

/** What a reply channel is called, which is what its own page's heading says. */
function channelLabelOf(document: IRDocument, channelId: string): string {
  const node = document.nodes.get(channelId);
  if (node?.kind !== 'channel') return channelId;

  return node.address ?? node.title ?? node.id;
}

/**
 * The reply of a request-reply operation, per SPEC 8.2, or null on a one way operation.
 *
 * AN EMPTY `reply` IS NOT NOTHING. The normalizer carries `reply: {}` as an empty record because
 * it says the operation is one half of a request-reply pair, which is a fact an operation with no
 * `reply` does not carry, and a model that dropped it here would lose exactly that fact.
 */
function channelReplyModel(
  reply: IRChannelReply | undefined,
  context: ModelContext,
): ChannelReplyModel | null {
  if (reply === undefined) return null;

  const channelId = reply.channelId ?? '';

  return {
    channelId,
    channelHref: channelId === '' ? '' : nodeHref(channelId, context.basePath),
    channelLabel: channelId === '' ? '' : channelLabelOf(context.document, channelId),
    messages: reply.messageIds ?? [],
    address: reply.address ?? '',
  };
}

/**
 * A payload or a headers block of a message, per SPEC 11.
 *
 * TWO OUTCOMES AND NEVER A THIRD. A JSON Schema compatible body keeps its slot, and the reading
 * rows are built from it where a tree would have been; a body in a dialect no JSON Schema reader
 * can read keeps its source and its dialect's name, which is the product claim of SPEC 11 rather
 * than an implementation shortcut. A failed schema view is not one of the two.
 */
function messageBodyModel(
  slot: IRSchemaSlot | undefined,
  context: ModelContext,
): MessageBodyModel | null {
  if (slot === undefined) return null;

  const schema = slot.kind === 'inline' ? slot.schema : context.document.schemas.get(slot.schemaId);
  if (schema === undefined) return null;

  const dialect = DIALECT_LABELS[schema.dialect];

  if (schema.normalized !== undefined) return { dialect, schema: slot, sourceHtml: '' };

  return {
    dialect,
    schema: null,
    sourceHtml:
      schema.raw === undefined
        ? ''
        : context.markdown.renderCode(`${JSON.stringify(schema.raw, null, 2)}\n`, 'json'),
  };
}

/**
 * The declared examples of one message, which are messages and not payloads.
 *
 * PER SPEC 8.2, AN EXAMPLE OF A MESSAGE IS THE MESSAGE. AsyncAPI writes `headers` and `payload`
 * in one example, and `IRExample.value` is one value, so the normalizer stores the object with
 * whichever of the two keys the document wrote. Printing only the payload here would lose the
 * headers of every example that has them, twice over.
 */
function messageExampleModels(
  examples: Readonly<Record<string, IRExample>> | undefined,
  context: ModelContext,
): MessageExampleModel[] {
  if (examples === undefined) return [];

  return Object.keys(examples)
    .sort(compareByCodePoint)
    .map((name) => {
      const example = examples[name];

      return {
        name,
        summary: example?.summary ?? '',
        sourceHtml:
          example?.value === undefined
            ? ''
            : context.markdown.renderCode(`${JSON.stringify(example.value, null, 2)}\n`, 'json'),
      };
    });
}

/** One message of a channel, with its two bodies resolved and its examples highlighted. */
function messageModel(message: IRMessage, context: ModelContext): MessageModel {
  const title = message.title ?? message.name ?? message.id;

  return {
    id: message.id,
    title,
    // The machine name only where it says something the title does not, the F15 rule the
    // operation header already applies to its own subtitle.
    name: message.name === undefined || message.name === title ? '' : message.name,
    summary: message.summary ?? '',
    descriptionHtml: context.markdown.render(message.description),
    contentType: message.contentType ?? '',
    correlationId: message.correlationId ?? '',
    tags: message.tags ?? [],
    payload: messageBodyModel(message.payload, context),
    headers: messageBodyModel(message.headers, context),
    bindings: bindingModels(message.bindings, context),
    examples: messageExampleModels(message.examples, context),
  };
}

/** What a channel page is about, per SPEC 11. */
function channelModel(channel: IRChannel, context: ModelContext): ChannelModel {
  return {
    protocol: channel.protocol ?? '',
    parameters: channelParameterModels(channel.parameters, context),
    servers: channelServerModels(channel, context.document),
    bindings: bindingModels(channel.bindings, context),
    operations: channel.operations.map((operation) => ({
      id: operation.id,
      direction: operation.direction,
      summary: operation.summary ?? '',
      descriptionHtml: context.markdown.render(operation.description),
      messages: operation.messageIds,
      bindings: bindingModels(operation.bindings, context),
      reply: channelReplyModel(operation.reply, context),
      tags: operation.tags ?? [],
      security: securityModels(operation.security ?? [], context.document),
    })),
    messages: channel.messages.map((message) => messageModel(message, context)),
  };
}

/**
 * The card of one federated service, per SPEC 15.3, or null when the id names none.
 *
 * NULL RATHER THAN A MISSING FLAG, the node page's rule: an unmerged document has no services at
 * all, and a wrong id on a merged one is a stale link, so the caller answers 404 off the same
 * absence either way and the model never draws a card about nothing.
 */
function servicePageModel(context: ModelContext, serviceId: string): ServicePageModel | null {
  const service = context.document.services?.find((entry) => entry.id === serviceId);
  if (service === undefined) return null;

  let operations = 0;
  for (const node of context.document.nodes.values()) {
    if (node.serviceId === serviceId) operations += 1;
  }

  // GUARDED HERE AND NOT BY THE DEFAULT PARAMETER: a service with no report of its own must
  // draw the absence, per SPEC 7.3, and falling through to the merged document's report would
  // show it another service's findings under its own name.
  const health =
    service.health === undefined
      ? null
      : buildHealthModel(context.document, context.basePath, service.health);

  return {
    id: service.id,
    title: service.info.title,
    version: service.info.version,
    descriptionHtml: context.markdown.render(service.info.description),
    kind: service.kind,
    prefix: service.prefix ?? '',
    servers: service.servers.map((server) => server.url),
    documentId: service.documentId,
    documentHash: service.documentHash,
    operations,
    collectors: service.runtime?.collectors ?? [],
    health,
    healthRendered: health !== null,
  };
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
      dialect: '',
    };
  }

  const body = entry.normalized;

  return {
    id: schemaId,
    name: schemaDisplayName(entry, schemaId),
    descriptionHtml: context.markdown.render(body?.description),
    deprecated: body?.deprecated ?? false,
    missing: false,
    dialect: DIALECT_LABELS[entry.dialect],
  };
}

/**
 * Which sections of the operation article the server draws, in draw order, per `TX-ADOPT`.
 *
 * THE ONE OWNER OF THE PAGE'S SHAPE. These are the conditions `NodePanel` used to compute
 * inline, moved here so that both sides of hydration walk one list instead of re-deriving
 * them: the client's state block empties the fields these conditions read, so a client that
 * recomputed them would draw a different tree than the server did, silently.
 */
function drawnOf(node: Omit<NodeModel, 'drawn'>): NodeModel['drawn'] {
  const marks = node.runtime?.responseMarks ?? [];
  const contracts = node.runtime?.contracts ?? [];

  return [
    'header' as const,
    ...(node.runtime !== null ? ['runtime' as const] : []),
    ...(node.descriptionHtml !== '' ? ['description' as const] : []),
    // The security list draws only when there is no parity scale carrying the same assertion,
    // which is the rule `TX-GUTTER` set: the authentication and scopes rows are where the
    // requirement stands when runtime exists.
    ...(node.security.length > 0 && node.runtime === null ? ['security' as const] : []),
    ...(node.parameters.length > 0 ? ['params' as const] : []),
    ...(node.requestBody.length > 0 ? ['request' as const] : []),
    // The responses section mounts when there is anything to say: documented rows, a code only
    // the runtime knows, or the error contracts grid, which lives inside it since `TX-ADOPT`.
    ...(node.responses.length > 0 || marks.length > 0 || contracts.length > 0
      ? ['responses' as const]
      : []),
    ...(node.codeSamples.length > 0 ? ['samples' as const] : []),
    // THE THREE CHANNEL SECTIONS OF `T050`, drawn from the same list for the same reason: the
    // client walks `drawn` and never recomputes a condition over a `channel` that arrives null.
    // The facts section draws when the channel says anything about itself beyond its address,
    // which the header already carries; a channel that says nothing more gets no empty block,
    // per SPEC 6.3's absence rule read for the document side.
    ...(channelFactsDrawn(node.channel) ? ['channel' as const] : []),
    ...((node.channel?.operations.length ?? 0) > 0 ? ['channel-operations' as const] : []),
    ...((node.channel?.messages.length ?? 0) > 0 ? ['messages' as const] : []),
  ];
}

/** Whether the channel facts section has anything the header does not already say. */
function channelFactsDrawn(channel: ChannelModel | null): boolean {
  if (channel === null) return false;

  return (
    channel.protocol !== '' ||
    channel.parameters.length > 0 ||
    channel.servers.length > 0 ||
    channel.bindings.length > 0
  );
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
    const channel: Omit<NodeModel, 'drawn'> = {
      ...base,
      // A channel has no operationId: the field is OpenAPI's, and an empty string is the
      // honest answer the kicker draws nothing from.
      operationId: '',
      method: null,
      path: null,
      address: view.node.address ?? null,
      sse: false,
      parameters: [],
      requestBody: [],
      responses: [],
      security: [],
      codeSamples: [],
      codeSamplesElsewhere: [],
      run: null,
      channel: channelModel(view.node, context),
      runtime,
    };

    return { ...channel, drawn: drawnOf(channel) };
  }

  const factOf = parameterFactsOf(view.node.runtime);
  const parameters = [...view.parameters.values()]
    .flat()
    .map((parameter) => parameterModel(parameter, context, factOf(parameter)));

  const operation: Omit<NodeModel, 'drawn'> = {
    ...base,
    // The public operation id of SPEC 5.4: the author's own whenever they wrote a real one,
    // which is what the kicker quotes.
    operationId: view.node.operationId ?? '',
    method: view.node.method.toUpperCase(),
    path: view.node.path,
    address: null,
    sse: operationIsSse(document, nodeId),
    parameters,
    requestBody: (view.node.requestBody?.content ?? []).map((media) =>
      mediaTypeModel(media, context, 'request'),
    ),
    responses: view.responses.map((response) => {
      const link = responseSchemaLink(response.content, context);

      return {
        statusCode: response.statusCode,
        descriptionHtml: markdown.render(response.description),
        content: response.content.map((media) => mediaTypeModel(media, context, 'response', false)),
        phrase: reasonPhrase(response.statusCode),
        ...link,
      };
    }),
    security: view.security.map((requirement) => ({
      schemeId: requirement.schemeId,
      type: requirement.scheme?.type ?? 'unknown',
      in: requirement.scheme?.in ?? '',
      name: requirement.scheme?.name ?? '',
      scopes: requirement.scopes,
    })),
    codeSamples: codeSampleModels(view.node, context),
    codeSamplesElsewhere: (view.node.codeSamplesElsewhere ?? []).map((language) => ({
      lang: language.lang,
      label: language.label,
    })),
    run: runnerOperationOf(view.node, document),
    channel: null,
    runtime,
  };

  return { ...operation, drawn: drawnOf(operation) };
}

/**
 * The named schema a slot resolves to, descending into array items, per `TX-PARITY-UI`.
 *
 * ONLY A NAMED SCHEMA HAS A PAGE, so an inline slot counts exactly when its body is a
 * reference to one, or an array whose items are: a list operation's 200 is an inline array of
 * `OrderDto` references, and a rule that refused to look inside it landed the schema tab on
 * the `ProblemDto` of the first error response, which is item 28 of the parity report. The
 * descent follows `items` only: `array` says where the reader's data is, and a deeper guess
 * would be a guess.
 */
function namedSchemaOf(
  slot: IRSchemaSlot | null | undefined,
  document: IRDocument,
): { readonly id: string; readonly array: boolean } | null {
  if (slot === null || slot === undefined) return null;
  if (slot.kind === 'named') {
    return document.schemas.has(slot.schemaId) ? { id: slot.schemaId, array: false } : null;
  }

  let body = slot.schema.normalized;
  let array = false;

  while (body !== undefined) {
    if (body.$ref !== undefined) {
      return document.schemas.has(body.$ref) ? { id: body.$ref, array } : null;
    }

    const items = body.items;
    if (items === undefined || typeof items !== 'object') return null;
    body = items;
    array = true;
  }

  return null;
}

/**
 * The compact row's schema link: the first response media that resolves to a named schema.
 *
 * `OrderDto[]` for an array of a named schema, because the row states what the response
 * carries and a bare `OrderDto` would state one where the wire has many.
 */
function responseSchemaLink(
  content: readonly IRMediaType[],
  context: ModelContext,
): { readonly schemaLabel: string; readonly schemaHref: string } {
  for (const media of content) {
    const named = namedSchemaOf(media.schema, context.document);
    if (named === null) continue;

    const entry = context.document.schemas.get(named.id);
    const name = schemaDisplayName(entry, named.id);

    return {
      schemaLabel: named.array ? `${name}[]` : name,
      schemaHref: schemaHref(named.id, context.basePath),
    };
  }

  return { schemaLabel: '', schemaHref: '' };
}

/**
 * The first named schema an operation touches, request body before responses in served order,
 * descending into array items, per SPEC 11 as amended with `TX-PARITY-UI`.
 *
 * This is what the schema tab and the shapes tab follow: the layout's schema page shows the
 * request schema of the operation the reader came from.
 */
function primarySchemaIdOf(document: IRDocument, node: NodeModel): string | null {
  const slots = [
    ...node.requestBody.map((media) => media.schema),
    ...node.responses.flatMap((response) => response.content.map((media) => media.schema)),
  ];

  for (const slot of slots) {
    const named = namedSchemaOf(slot, document);
    if (named !== null) return named.id;
  }

  return null;
}

/** Whether a navigation subtree holds the given schema. */
function holdsSchema(entry: IRNavNode, schemaId: string): boolean {
  if (entry.schemaId === schemaId) return true;
  return entry.children.some((child) => holdsSchema(child, schemaId));
}

/**
 * Breadcrumb of the current node, per SPEC 11: the group, then what the node answers on.
 *
 * A SCHEMA'S GROUP IS READ OFF THE NAVIGATION AND NEVER SPELLED HERE, since `TX-MARKUP`
 * completed the crumb for the one page kind whose crumb was bare. The registry group's label is
 * `schemasLabel ?? 'Schemas'` in core, so a second spelling of the word in this file would
 * drift the day a host renames the group.
 */
function crumbOf(
  document: IRDocument,
  node: NodeModel | null,
  schema: SchemaPageModel | null,
  service: ServicePageModel | null = null,
): string {
  if (node !== null) {
    const address =
      node.method !== null ? `${node.method} ${node.path ?? ''}` : (node.address ?? '');
    return [node.tags[0], address].filter((part) => part !== undefined && part !== '').join(' / ');
  }

  // The service card's crumb is the group's own words: the label the rail draws for the
  // service is its title, so the crumb repeats no second vocabulary.
  if (service !== null) return `Services / ${service.title}`;

  if (schema === null) return '';

  const group = document.navigation.find(
    (entry) =>
      entry.nodeId === undefined && entry.schemaId === undefined && holdsSchema(entry, schema.id),
  );

  return [group?.label, schema.name]
    .filter((part) => part !== undefined && part !== '')
    .join(' / ');
}

/** The rail's stats row: the document's counts, per SPEC 7.3's null-against-zero rule. */
function frameStats(document: IRDocument): FrameStatsModel {
  return {
    operations: document.nodes.size,
    groups: document.navigation.filter(
      (entry) => entry.nodeId === undefined && entry.schemaId === undefined,
    ).length,
    drift: document.health === undefined ? null : document.health.drift.length,
  };
}

/**
 * The frame of one page: which tabs the server can resolve, and where they lead.
 *
 * SIX CONSTANT ITEMS BY REMEMBERING RATHER THAN BY HIDING, per SPEC 11 as amended with
 * `TX-PARITY-UI`: the bar's order is the prototype's, operation, schema, shapes, bench,
 * health, states. The server still resolves only what it can: the operation pages carry all
 * six, a schema or shapes page carries its own two, the document pages carry the last two.
 * The client's memory merges the operation tabs back on the pages that have none, and every
 * stored href is one this function resolved, so no address is spelled twice. The bench tab
 * exists exactly when `run` does, per the F14 rule: constancy is about page kinds, not about
 * promising a console to a channel.
 */
function buildFrame(
  document: IRDocument,
  kind: PageKind,
  node: NodeModel | null,
  schema: SchemaPageModel | null,
  basePath: string,
  service: ServicePageModel | null = null,
): FrameModel {
  const tabs: FrameTabModel[] = [];

  if (node !== null && (kind === 'node' || kind === 'bench')) {
    tabs.push({
      kind: 'node',
      href: nodeHref(node.id, basePath),
      active: kind === 'node',
      count: node.runtime?.drift.length ?? 0,
    });

    const primarySchema = primarySchemaIdOf(document, node);
    if (primarySchema !== null) {
      tabs.push({
        kind: 'schema',
        href: schemaHref(primarySchema, basePath),
        active: false,
        count: 0,
      });
      tabs.push({
        kind: 'shapes',
        href: shapesHref(primarySchema, basePath),
        active: false,
        count: 0,
      });
    }

    if (node.run !== null) {
      tabs.push({
        kind: 'bench',
        href: benchHref(node.id, basePath),
        active: kind === 'bench',
        count: 0,
      });
    }
  }

  if (schema !== null && !schema.missing && (kind === 'schema' || kind === 'shapes')) {
    tabs.push({
      kind: 'schema',
      href: schemaHref(schema.id, basePath),
      active: kind === 'schema',
      count: 0,
    });
    tabs.push({
      kind: 'shapes',
      href: shapesHref(schema.id, basePath),
      active: kind === 'shapes',
      count: 0,
    });
  }

  tabs.push({
    kind: 'health',
    href: healthPageHref(basePath),
    active: kind === 'health',
    count: document.health?.drift.length ?? 0,
  });

  tabs.push({
    kind: 'states',
    href: statesHref(basePath),
    active: kind === 'states',
    count: 0,
  });

  const backHref =
    kind === 'overview'
      ? ''
      : kind === 'bench' && node !== null
        ? nodeHref(node.id, basePath)
        : kind === 'shapes' && schema !== null
          ? schemaHref(schema.id, basePath)
          : overviewHref(basePath);

  return {
    tabs,
    crumb: crumbOf(document, node, schema, service),
    backHref,
    stats: frameStats(document),
  };
}

/** The page kind, stated by the caller or derived the way it was before `TX-FRAME`. */
function resolveKind(options: PageModelOptions): PageKind {
  if (options.page !== undefined) return options.page;
  if ((options.nodeId ?? null) !== null) return 'node';
  if ((options.schemaId ?? null) !== null) return 'schema';
  return 'overview';
}

/**
 * Builds the model for one page.
 *
 * An unknown node id produces the overview rather than an error. A reference is served
 * over HTTP and a stale link is a normal event, not a failure of the renderer; the caller
 * decides whether to answer 404, and `PageModel.node` being null is what tells it. A bench
 * of an unknown node degrades the same way, to the overview.
 *
 * @param document - The normalized document
 * @param options - Which page, what to show on it, and the markdown renderer to use
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
  const requested = resolveKind(options);
  const wantsNode = requested === 'node' || requested === 'bench';
  const wantsSchema = requested === 'schema' || requested === 'shapes';

  const requestedNode = wantsNode ? (options.nodeId ?? null) : null;
  const node = requestedNode === null ? null : nodeModel(context, requestedNode);
  const requestedSchema = wantsSchema && node === null ? (options.schemaId ?? null) : null;
  const schema = requestedSchema === null ? null : schemaPageModel(context, requestedSchema);
  const requestedService = requested === 'service' ? (options.serviceId ?? null) : null;
  const service = requestedService === null ? null : servicePageModel(context, requestedService);

  // A requested page whose subject does not exist degrades to the page that can render:
  // the caller answers 404 off the same absence, and a direct call keeps the old behaviour.
  // The service card degrades the node page's way, and for the node page's reason.
  const kind: PageKind =
    (wantsNode && node === null) || (requested === 'service' && service === null)
      ? 'overview'
      : requested;

  const slots: IRSchemaSlot[] =
    node !== null && kind === 'node'
      ? slotsOf(node)
      : schema !== null && !schema.missing
        ? [{ kind: 'named', schemaId: schema.id }]
        : [];

  // THE PANEL TRAVELS WITH THE HEALTH PAGE AND WITH NOTHING ELSE, per SPEC 7.3 as amended
  // 2026-08-14. A report of four hundred findings shipped on every node page would be the
  // largest thing on a page it is not about; the overview lost it to the page the tab names.
  const health = kind === 'health' ? buildHealthModel(document, basePath) : null;

  // THE GRAPH TRAVELS WITH THE OVERVIEW AND WITH NOTHING ELSE, per SPEC 9.5. It is a statement
  // about the whole document, so it belongs on the page about the whole document; and it is null
  // rather than an empty graph when the document declares no edge, so the overview of a plain
  // OpenAPI file draws no heading for a section with nothing under it.
  const topology =
    kind === 'overview' && document.relationships.length > 0 ? buildTopology(document) : null;

  const payload = buildSchemaPayload(document, slots, options.schemaPayloadLimit);

  // RESPONSE SCHEMAS ARE LINK TARGETS AND NOT PAYLOAD, per `TX-PARITY-UI`: their ids join
  // `truncated` so a theme that still draws trees from `content` gets the recorded
  // degradation, the link to the schema's own page, rather than a silently empty expansion.
  const responseIds =
    node === null || kind !== 'node'
      ? []
      : node.responses
          .flatMap((response) =>
            response.content.map((media) => namedSchemaOf(media.schema, document)),
          )
          .filter((named): named is { id: string; array: boolean } => named !== null)
          .map((named) => named.id)
          .filter((id) => payload.schemas[id] === undefined);
  const truncated = [...new Set([...payload.truncated, ...responseIds])].sort(compareByCodePoint);

  const navigation = sliceNavigation(
    buildNavigation(document),
    node === null ? null : node.id,
    schema === null ? null : schema.id,
  );

  return {
    pageModelVersion: PAGE_MODEL_VERSION,
    kind,
    frame: buildFrame(document, kind, node, schema, basePath, service),
    documentId: document.id,
    documentHash: document.hash,
    title: document.info.title,
    version: document.info.version,
    descriptionHtml: markdown.render(document.info.description),
    basePath,
    ...(options.proxyPath === undefined ? {} : { proxyPath: options.proxyPath }),
    ...(options.directTarget === undefined ? {} : { directTarget: options.directTarget }),
    ...(options.staticProxy === undefined ? {} : { staticProxy: options.staticProxy }),
    servers: document.servers.map((server) => server.url),
    navigation: navigation.entries,
    navigationComplete: navigation.complete,
    navigationRows: navigation.total,
    activeNodeId: node === null ? null : node.id,
    activeSchemaId: schema === null ? null : schema.id,
    node,
    schema,
    service,
    schemas: payload.schemas,
    truncatedSchemas: truncated,
    health,
    healthRendered: health !== null,
    topology,
  };
}

export type {
  BindingModel,
  ChannelModel,
  ChannelOperationModel,
  ChannelParameterModel,
  ChannelReplyModel,
  ChannelServerModel,
  CodeSampleModel,
  MediaTypeModel,
  MessageBodyModel,
  MessageExampleModel,
  MessageModel,
  NavEntryModel,
  NodeModel,
  PageModel,
  ParameterModel,
  ResponseModel,
  SchemaPageModel,
  ServicePageModel,
  StaticProxyModel,
};

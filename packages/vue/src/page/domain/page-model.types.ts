/**
 * The projection: what the renderer hands a page, and therefore what a slot can receive.
 *
 * IT LIVES HERE RATHER THAN IN `@openref/render` BECAUSE THE SLOT CONTRACT IS DECLARED IN TERMS
 * OF IT, and `@openref/vue` may not import the renderer. That is the dependency rule of
 * STANDARDS 3.5 read forwards: the headless layer is what a theme is written against, so the
 * shapes a theme is handed belong to the headless layer, and the renderer is one producer of
 * them. The builders stay where they need markdown, a sanitizer and a highlighter, which is
 * `@openref/render`; only the shapes are here.
 *
 * EVERY FIELD IS SOMETHING THE BROWSER ACTUALLY HAS. Descriptions arrive as HTML the server
 * already rendered and sanitized, examples arrive already highlighted, a rate limit arrives in
 * words, a finding arrives as a row. The IR does not travel, per SPEC 12, and `AppShell` asking
 * for an `IRDocument` was measured at 1,612,858 bytes on `twilio-api-v2010.yaml` against a node
 * page's whole state block of 23,153. A prop declared in IR terms is a prop no page can supply.
 */

import type {
  IRConfidence,
  IRDriftRule,
  IRSchema,
  IRSchemaSlot,
  IRSchemaView,
  IRTopology,
} from '@openref/core';
import type { RunnerOperationView } from '../../runner/application/ports/runner.port';

/** One entry of the navigation tree, flattened to what a renderer needs. */
export interface NavEntryModel {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly nodeId: string | null;
  readonly schemaId: string | null;
  readonly deprecated: boolean;
  /**
   * Findings of the health report about this entry, summed over children for a group.
   *
   * ZERO MEANS NO MARKER AND NOT "MEASURED CLEAN". The rail's counter is a warning glyph, so
   * its absence asserts nothing, which is what lets one number serve both the document nothing
   * measured and the entry nothing was found on; the honest verdicts live on the parity scale,
   * where `unknown` and `match` are different answers per SPEC 6.3.
   */
  readonly driftCount: number;
  /**
   * The second line: `METHOD /path` for an operation, the address for a channel, empty for a
   * group.
   *
   * It exists because the label is the operation's summary when it has one, and a reader
   * searching for `/orders/{id}` would otherwise find nothing on a document whose authors
   * wrote summaries. It is what the command palette matches on as well as shows.
   */
  readonly hint: string;
  /**
   * Uppercase HTTP method of an operation, empty for a channel, a group or a schema.
   *
   * Since `TX-MARKUP` the rail draws an operation row as the badge and the path, per the
   * layout, and the badge needs the method apart from the hint: splitting the hint would read
   * a channel address as a method the day one contains a space.
   */
  readonly method: string;
  /**
   * True when the operation's declared responses carry `text/event-stream`.
   *
   * Since `TX-PARITY-UI` the rail draws `SSE` as the badge of such a row, per the layout: the
   * method stays a fact on `method`, and the badge is the design's identity mark. False for
   * channels, groups and schemas.
   */
  readonly sse: boolean;
  /**
   * Children this entry has in the whole navigation, which is not what it carries.
   *
   * A page ships the navigation it can draw and nothing else, so a closed group arrives with an
   * empty `children` and a count above zero. The two together are what let the sidebar render a
   * group as openable without holding what is inside it, and what let it tell a closed group
   * from an empty one, which look identical from `children`.
   */
  readonly childCount: number;
  /**
   * The federated service this entry is the group of, per SPEC 15.3, null everywhere else.
   *
   * Set only on the top level group a merge builds per service. It is what lets the rail link
   * the group to `service/{serviceId}` and hang the live status mark on it without parsing the
   * group's id, which an escaped clash would break.
   */
  readonly serviceId: string | null;
  readonly children: readonly NavEntryModel[];
}

/**
 * One row of the search overlay.
 *
 * IT IS THE PALETTE'S OWN ROW AND NOT A `SearchHit`, and the reason changed at T042 while the
 * shape did not. It used to be that the shipped palette searched the navigation slice and never
 * consulted an index at all; since T042 it fetches `<mount>/_search-index` on first open and
 * prefers index hits, falling back to the navigation match when the index has not arrived or did
 * not load. What has not changed is that both sources reduce to one row: the method and the path
 * arrive joined into one `hint` string rather than apart, so a position drawing a hit does not
 * have to know which of the two produced it. A prop declared as `SearchHit` would be a prop the
 * navigation half cannot supply.
 */
export interface PaletteHitModel {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly href: string;
}

/** One parameter row. */
export interface ParameterModel {
  readonly name: string;
  readonly location: string;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly typeLabel: string;
  /**
   * The description, as HTML the server rendered and sanitized.
   *
   * THIS IS THE MARKDOWN ANSWER, per SPEC 12. `IRParameter` carries the source, and a theme
   * handed the source would have to render markdown in the browser, which is the one thing the
   * prerender exists to prevent.
   */
  readonly descriptionHtml: string;
  /** Where the schema viewer starts for this row, null when the parameter declares none. */
  readonly schema: IRSchemaSlot | null;
  /**
   * What the runtime says about this parameter, in the scan's own vocabulary, per SPEC 6.2.1
   * and `TX-PARITY-UI`: `seen read`, `not seen read by the handler`, `not accounted for by the
   * scan`, `required by the application`. Empty when no fact touches the row, which is every
   * document-only page.
   */
  readonly runtimeNote: string;
  /** Level of the fact behind the note, or null when no fact touches the row, per SPEC 6.1. */
  readonly confidence: IRConfidence | null;
  /** Collector that produced the fact. Empty exactly when `confidence` is null. */
  readonly collector: string;
  /**
   * True when the scan's verdict is `not-seen-read`, which is the row SP010 names: the table
   * highlights it and the bench disables its field with the reason, per the SPEC 11 boundary
   * of the F14 rule. Never true for `unaccounted`, which is the scan speaking about itself.
   */
  readonly unread: boolean;
}

/** One media type of a body or a response, with its example already highlighted. */
export interface MediaTypeModel {
  readonly mediaType: string;
  readonly typeLabel: string;
  /** Highlighted example, empty when the media type is not one an example is generated for. */
  readonly exampleHtml: string;
  /**
   * Whether the server drew an example block for this media type, per `TX-ADOPT`.
   *
   * The flag and not the markup is what survives into the client's state block: the example is
   * static markup the browser adopts, so the client draws a childless element exactly when the
   * server drew one, and `exampleHtml` arrives emptied. On the server the two agree by
   * construction: `hasExample` is `exampleHtml !== ''` at build time.
   */
  readonly hasExample: boolean;
  /** Where the schema viewer starts for this media type, null when it declares no schema. */
  readonly schema: IRSchemaSlot | null;
  /** Which half of a schema this position shows, so the viewer filters the same way. */
  readonly view: IRSchemaView;
}

/**
 * One protocol binding block, kept verbatim and printed as source, per SPEC 8.2.
 *
 * A BINDING HAS NO ANALOGUE AND THEREFORE NO SHAPE THIS PROJECT MAY INVENT. `bindings.kafka` is
 * whatever the Kafka binding specification says it is, `bindings.amqp` whatever the AMQP one
 * says, and a model that named the members of either would be a reading of two specifications
 * this normalizer does not read. So the block travels as the source it was, already highlighted
 * on the server for the reason every other block of code on a page is, per SPEC 12.
 */
export interface BindingModel {
  /** Protocol name, which is the key the document wrote the block under. */
  readonly protocol: string;
  /** The block as source, already highlighted. */
  readonly sourceHtml: string;
}

/**
 * One variable of a templated channel address, per SPEC 8.2.
 *
 * IT IS NOT A {@link ParameterModel} AND THE DIFFERENCE IS A TYPE RATHER THAN A LAYOUT.
 * `ParameterModel.location` is `path`, `query`, `header` or `cookie`, which is OpenAPI's set, and
 * a channel variable is in none of the four; printing one in that table would tell a reader a
 * location it does not have. Every member is present and empty rather than absent, the
 * {@link RuntimeValueModel} rule: a theme tests one field instead of narrowing a union.
 */
export interface ChannelParameterModel {
  /** The name between the braces of the address. */
  readonly name: string;
  readonly descriptionHtml: string;
  /** The values the substitution may take, empty when the document limits it to none. */
  readonly values: readonly string[];
  /** What is substituted when nothing else is. Empty when the document wrote none. */
  readonly fallback: string;
  readonly examples: readonly string[];
  /** A runtime expression saying where in the message the value is found. Empty when none. */
  readonly location: string;
}

/** One server a channel is available on, per SPEC 8.2's absent-or-empty rule. */
export interface ChannelServerModel {
  readonly url: string;
  /** Protocol of the server, `kafka` or `ws`. Empty when the document wrote none. */
  readonly protocol: string;
  readonly protocolVersion: string;
  readonly description: string;
  /**
   * What connecting to this server requires, per SPEC 8.2, resolved against the document's table.
   *
   * IT IS THE SERVER'S AND NOT THE CHANNEL'S, because AsyncAPI writes `security` on the Server
   * Object and there is no such member on a channel in either edition. Empty when the server
   * declared none and when it said it has none, which the model does not tell apart: the
   * difference lives in `IRServer.security` being absent against present and empty, and a page
   * that drew "declares no security" would be printing a sentence about a distinction no reader
   * asked for.
   */
  readonly security: readonly SecurityModel[];
}

/**
 * The reply half of a request-reply operation, per SPEC 8.2.
 *
 * THE THREE MEMBERS STAY THREE. A reply naming a channel, a reply naming messages and a reply
 * naming an address are three different statements, and an operation carrying an empty `reply` is
 * a fourth: it says the operation is one half of a request-reply pair and nothing more, which is
 * a fact an operation with no `reply` does not carry.
 */
export interface ChannelReplyModel {
  /** Node id of the reply channel. Empty when the document named none. */
  readonly channelId: string;
  /** The reply channel's own page. Empty exactly when `channelId` is. */
  readonly channelHref: string;
  /** What the reply channel is called: its address, or its title, or its id. */
  readonly channelLabel: string;
  /** Ids of the reply messages, local to the reply channel. Empty when the document named none. */
  readonly messages: readonly string[];
  /** A runtime expression saying where the reply is sent. Empty when none. */
  readonly address: string;
}

/** One `send` or `receive` operation of a channel, per SPEC 8.2. */
export interface ChannelOperationModel {
  readonly id: string;
  /** `send` or `receive`, which is the whole of what AsyncAPI says about direction. */
  readonly direction: string;
  readonly summary: string;
  readonly descriptionHtml: string;
  /** Ids of the messages this operation carries, into {@link ChannelModel.messages}. */
  readonly messages: readonly string[];
  readonly bindings: readonly BindingModel[];
  /** The reply, or null on a one way operation. */
  readonly reply: ChannelReplyModel | null;
  readonly tags: readonly string[];
  /**
   * What performing this operation requires, per SPEC 8.2, resolved against the document's table.
   *
   * SEPARATE FROM {@link ChannelServerModel.security} ON PURPOSE. AsyncAPI's own sentence is that
   * a server's security applies as well where there is any, so this is what the operation adds
   * rather than what it replaces, and merging the two lists would erase the difference between
   * what connecting costs and what performing costs.
   */
  readonly security: readonly SecurityModel[];
}

/**
 * A payload or a headers block of a message, per SPEC 8.2 and SPEC 11.
 *
 * IT CARRIES THE SLOT AND NOT THE ROWS, the {@link MediaTypeModel} rule: the reading rows are
 * computed from the page's bounded schema payload where the tree would have been, so a body that
 * points at a named schema this page did not ship draws the link the viewer already draws.
 *
 * `sourceHtml` IS THE OTHER HALF AND IT IS A PRODUCT CLAIM. An Avro or Protobuf payload keeps its
 * source and a named dialect rather than being translated into JSON Schema, because translating
 * would lose union with null, default values and field order, which is what those formats are
 * taken for. It is never a failed schema view.
 */
export interface MessageBodyModel {
  /** The dialect in the reader's words, `Avro`. Empty when the dialect has no readable name. */
  readonly dialect: string;
  /** Where the reading rows start, null when the body is not JSON Schema compatible. */
  readonly schema: IRSchemaSlot | null;
  /** The source, already highlighted, for a body no JSON Schema reader can read. Empty otherwise. */
  readonly sourceHtml: string;
}

/** One declared example of a message, which is the message and not only its payload. */
export interface MessageExampleModel {
  /** The name the document wrote the example under. */
  readonly name: string;
  readonly summary: string;
  /** The example as source, already highlighted. */
  readonly sourceHtml: string;
}

/** One message that can travel over a channel, per SPEC 8.2. */
export interface MessageModel {
  readonly id: string;
  /** What the message is called: its title, or its name, or its id. */
  readonly title: string;
  /** The machine name the document wrote, when it wrote one and it differs from the title. */
  readonly name: string;
  readonly summary: string;
  readonly descriptionHtml: string;
  /** Media type of the payload, the document's own or the one it inherited. Empty when neither. */
  readonly contentType: string;
  /** The `location` runtime expression of SPEC 8.2, never the prose beside it. Empty when none. */
  readonly correlationId: string;
  readonly tags: readonly string[];
  readonly payload: MessageBodyModel | null;
  readonly headers: MessageBodyModel | null;
  readonly bindings: readonly BindingModel[];
  readonly examples: readonly MessageExampleModel[];
}

/**
 * What a channel page is about, null on every operation page, per SPEC 11.
 *
 * ONE MEMBER RATHER THAN SEVEN ON {@link NodeModel}, because a channel either is one or is not:
 * an operation carrying seven empty channel fields would be seven ways to ask one question, and a
 * theme would have to know which of them decides.
 */
export interface ChannelModel {
  /** Protocol, when every server the channel binds to agrees on one. Empty otherwise. */
  readonly protocol: string;
  /** Variables of a templated address, in code point order of their names. */
  readonly parameters: readonly ChannelParameterModel[];
  /** Servers the channel is available on, which is all of the document's when it names none. */
  readonly servers: readonly ChannelServerModel[];
  readonly bindings: readonly BindingModel[];
  readonly operations: readonly ChannelOperationModel[];
  readonly messages: readonly MessageModel[];
}

/**
 * One federated service on its card, per SPEC 15.3.
 *
 * WHAT IT CARRIES IS WHAT THE SERVICE SAID ABOUT ITSELF, which is the half of `IRService` that
 * would be invisible without a page: the merged document's header is the caller's, so the
 * service's own title, version, servers and prefix have nowhere else to be shown. The health
 * report is the service's own, with findings already addressed to merged names per SPEC 15.1,
 * so every row can link to a node this document really has.
 */
export interface ServicePageModel {
  /** Service identity, as the federation configuration names it. */
  readonly id: string;
  /** The service's own title, from its document header. */
  readonly title: string;
  readonly version: string;
  readonly descriptionHtml: string;
  /** `http`, `events` or `mixed`, as the source document was. */
  readonly kind: string;
  /** Path prefix every address of the service was moved under. Empty when none applied. */
  readonly prefix: string;
  /** The service's own servers, which the merged header deliberately does not carry. */
  readonly servers: readonly string[];
  /** `IRDocument.id` of the source document, which is not always the service id. */
  readonly documentId: string;
  /** `IRDocument.hash` of the source document, so a refreshed remote is tellable. */
  readonly documentHash: string;
  /** Nodes of the merged document that belong to this service. */
  readonly operations: number;
  /** Collectors that ran on the service, per SPEC 6. Empty when none did. */
  readonly collectors: readonly string[];
  /**
   * The service's own health report, drawn like the health page's panel.
   *
   * SERVER DRAWN AND REDACTED IN TRANSIT, the health page's own rule: the serializer writes
   * null here whatever the report is, and `healthRendered` beside it is what the client reads.
   */
  readonly health: HealthModel | null;
  /** Whether the server drew a health panel for this service. */
  readonly healthRendered: boolean;
}

/** A named schema shown on a page of its own. */
export interface SchemaPageModel {
  /** Key into the shipped schema map, suffix and all. */
  readonly id: string;
  /** What a reader is shown, which is never the identity suffix of an external target. */
  readonly name: string;
  readonly descriptionHtml: string;
  readonly deprecated: boolean;
  /** True when the id names nothing in the document, so the page says so instead of blanking. */
  readonly missing: boolean;
  /**
   * The dialect line of the page head, in the reader's words, `JSON Schema 2020-12`.
   *
   * Added with `TX-MARKUP`, additive and minor. Empty when the schema is missing, because a
   * page that says which dialect a schema it does not have is written in would be guessing.
   */
  readonly dialect: string;
}

/**
 * One response row, compact since `TX-PARITY-UI`: badge, phrase, schema link, note.
 *
 * `content` stays for shape compatibility and still lists the declared media types, but the
 * response `exampleHtml` is built empty and response schemas leave the page's schema payload:
 * the schemas live on their own pages, which is where `schemaHref` leads. A theme that drew
 * trees from `content` finds the payload truncated and draws the link, the existing
 * degradation.
 */
export interface ResponseModel {
  readonly statusCode: string;
  readonly descriptionHtml: string;
  readonly content: readonly MediaTypeModel[];
  /** Reason phrase of the code, `Created`, empty for a code outside the registry's list. */
  readonly phrase: string;
  /**
   * Display name of the schema this response answers with, `OrderDto[]` for an array of a
   * named schema. Empty when the response declares none the document has a page for.
   */
  readonly schemaLabel: string;
  /** The schema's own page. Empty exactly when `schemaLabel` is. */
  readonly schemaHref: string;
}

/** One security requirement, resolved against the document's schemes. */
export interface SecurityModel {
  readonly schemeId: string;
  readonly type: string;
  /**
   * Where the key travels, out of the scheme's own `in`. Empty when the scheme declares none.
   *
   * ADDED 2026-08-29, WITH `name` BESIDE IT, when channel security first got drawn. A requirement
   * carrying only a type says `apiKey` and says nothing about where the key goes, which is the
   * partial picture `IRSecurityScheme.in` was grown to five values to stop the IR from having.
   * The model repeated that gap one level up. It is a string rather than the IR's union because a
   * page model carries what a theme prints, and the five values are the scheme's vocabulary.
   */
  readonly in: string;
  /** Name of the header, query parameter or cookie the key travels under. Empty when none. */
  readonly name: string;
  readonly scopes: readonly string[];
}

/**
 * One call sample, per SPEC 18, already highlighted.
 *
 * The generator of levels 1 and 2 arrives in T057; what a document writes under
 * `x-codeSamples` is level 3 and has the highest priority, so it is read first and both
 * produce this shape.
 */
export interface CodeSampleModel {
  /** Language identifier, as the highlighter understands it, for example `bash` or `python`. */
  readonly lang: string;
  /** What the tab says, for example `cURL`. */
  readonly label: string;
  /** The sample, highlighted on the server like every other block of code on the page. */
  readonly sourceHtml: string;
}

/**
 * One language this operation has a sample in that the page is not carrying, per SPEC 18.
 *
 * A NAME WITHOUT A SOURCE, WHICH IS THE WHOLE OF IT. SPEC 18 keeps fifteen languages and the page
 * draws twelve of them; the three it does not draw are named here rather than dropped, so that a
 * reader can tell a language this reference does not have from a language it can produce. The
 * source is exactly what was not carried, so it is not in this shape.
 */
export interface CodeSampleLanguageModel {
  /** Language identifier, as {@link CodeSampleModel.lang} spells it. */
  readonly lang: string;
  /** What a tab would have said, for example `Ruby`. */
  readonly label: string;
}

/**
 * Languages that could not write this request at all, and the one reason they gave, per SPEC 18.
 *
 * THE OTHER HALF OF {@link CodeSampleLanguageModel}, AND THE HALF THAT WAS MISSING. A language the
 * page holds back is named beside the tabs; a language whose emitter refused this request simply
 * had no tab, so a reader met the same silence for two different facts. SPEC 18's standing rule is
 * that where a request cannot be expressed faithfully the page says so, and this is what it says
 * it with.
 *
 * GROUPED BY REASON, BECAUSE A REFUSAL IS USUALLY SHARED. Nine templates decline a multipart body
 * in the same words, and repeating that sentence nine times would put it nine times into a page
 * state block whose size SPEC 20 already reports over its cap.
 */
export interface CodeSampleRefusalModel {
  /** Why none of these languages could write this request, in the emitter's own words. */
  readonly reason: string;
  /** The languages that gave this reason, in the order the page would have met them. */
  readonly languages: readonly CodeSampleLanguageModel[];
}

/**
 * Something true about a sample that is drawn and correct, per SPEC 18.
 *
 * THE THIRD KIND OF SENTENCE UNDER THE TABS, AND NOT A SOFTER REFUSAL. A refusal says there is no
 * sample because one would have sent something other than the plan. A note says the sample sends
 * exactly the plan and there is one more thing to know: this client follows a redirect where the
 * console does not, the credential this operation needs travels in no request at all, or the
 * document wrote two samples under one language and a strip keyed by language shows one.
 *
 * BOTH OF ITS FIRST TWO SOURCES WERE COMPUTED AND DISCARDED. `GeneratedSamples.notes` and
 * `PlaceholderCredentials.unsendable` were produced by the generator and dropped by the transform,
 * so a reader was never told that four of their twelve tabs behave unlike the button, nor that an
 * operation behind a client certificate draws twelve samples that cannot authenticate.
 */
export interface CodeSampleNoteModel {
  /** What a reader has to know about these samples, in the words of whoever measured it. */
  readonly note: string;
  /** The languages it is true of, in the order the page would have met them. */
  readonly languages: readonly CodeSampleLanguageModel[];
}

/**
 * The head of a node page: what the operation is, and nothing about what it carries.
 *
 * SEPARATE FROM {@link NodeModel} BECAUSE THE HEADER POSITION IS HANDED THIS AND NOT THAT. The
 * value that arrives is the page's own node model, which extends this, so nothing is copied per
 * render; what the contract promises is these ten fields, eight until `TX-MARKUP` widened the
 * promise for the kicker, and a theme that reads more than it was promised is reading something
 * that may move.
 */
export interface NodeHeaderModel {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly deprecated: boolean;
  /** HTTP method, uppercase, absent for a channel. */
  readonly method: string | null;
  /** Path template, absent for a channel. */
  readonly path: string | null;
  /** Channel address, absent for an operation. */
  readonly address: string | null;
  readonly summary: string;
  /**
   * Tags of the node, in document order. The kicker draws the first.
   *
   * Promised here since `TX-MARKUP`; the field always travelled on {@link NodeModel}, so this
   * is the promise widening, not the value moving.
   */
  readonly tags: readonly string[];
  /**
   * The public operation id of SPEC 5.4, empty only on a channel.
   *
   * The author's own whenever they wrote a real one; T004 rewrites only a generated
   * `Controller_method` shape and keeps the original in the IR. The kicker draws this because
   * it is the name the document answers to, not a private derivation.
   */
  readonly operationId: string;
  /**
   * True when the declared responses carry `text/event-stream`, per `TX-PARITY-UI`: the
   * header and the bench head draw `SSE` as the badge, the same mark the rail draws. The
   * method stays on `method`; the badge is the design's identity mark, and the parity
   * streaming row carries the transport's detail.
   */
  readonly sse: boolean;
}

/**
 * One section of the operation article, named for the walk of `TX-ADOPT`.
 *
 * `errors` is not here and its absence is the single-root decision of SPEC 10.4: the error
 * contracts grid is a section inside the responses section since `TX-ADOPT`, so `responses`
 * covers both and a fragment never has to be adopted.
 *
 * THREE MARKS ARRIVED AT `T050` FOR THE CHANNEL PAGE, AND THE UNION GROWING IS A BREAKING CHANGE
 * rather than an additive one, by the rule `ai-docs/design/CONTRACT.md` states for
 * `StateNoticeKind` and applies here: the sanctioned total spelling over this union is an
 * exhaustive `switch` with no `default`, the renderer's own composition is written that way on
 * purpose, and a composition spelled that way does not compile until each new mark is drawn. The
 * three are the sections a channel has and an operation does not: `channel` for the address, its
 * variables, the protocol, the servers and the bindings; `channel-operations` for the `send` and
 * `receive` operations with their replies; `messages` for the payloads, headers, correlation
 * expressions and examples. Recorded there and in `packages/vue/PUBLIC-API.md` before the code.
 */
export type NodeSectionMark =
  | 'header'
  | 'runtime'
  | 'description'
  | 'security'
  | 'params'
  | 'request'
  | 'responses'
  | 'samples'
  | 'channel'
  | 'channel-operations'
  | 'messages';

/** The node a page is about. */
export interface NodeModel extends NodeHeaderModel {
  readonly descriptionHtml: string;
  /**
   * Which sections of the operation article the server drew, in draw order, per `TX-ADOPT`.
   *
   * ONE OWNER FOR THE PAGE'S SHAPE. The model builder computes this from the same conditions
   * the composition used to hold, and both sides of hydration walk it instead of re-deriving
   * the conditions from fields the client's state block no longer carries. A section in the
   * list was drawn; a section not in it was not; a client that recomputed `parameters.length`
   * over a redacted model would draw a different tree than the server did, silently.
   */
  readonly drawn: readonly NodeSectionMark[];
  readonly parameters: readonly ParameterModel[];
  readonly requestBody: readonly MediaTypeModel[];
  readonly responses: readonly ResponseModel[];
  readonly security: readonly SecurityModel[];
  /** Call samples the document wrote, per SPEC 18. Empty when it wrote none. */
  readonly codeSamples: readonly CodeSampleModel[];
  /**
   * Languages this operation has a sample in that the page did not draw, per SPEC 18.
   *
   * REQUIRED RATHER THAN OPTIONAL, for the reason `NodeModel.channel` states: a member a producer
   * may leave out is a member whose absence means both "there are none" and "nobody looked", and
   * the difference here is the whole point of the member. The producer set is the one function
   * `nodeModel`, and the empty list is the ordinary answer, on every channel and on every page
   * whose document was never put through `withGeneratedSamples`.
   */
  readonly codeSamplesElsewhere: readonly CodeSampleLanguageModel[];
  /**
   * Languages that wrote no sample for this request, with the reason, per SPEC 18.
   *
   * REQUIRED FOR THE REASON THE MEMBER ABOVE IS, AND ANSWERING THE OTHER HALF OF ONE QUESTION.
   * Together with `codeSamples` and `codeSamplesElsewhere` it accounts for every language the
   * generator was asked about: drawn, held back, or unable. The empty list is the ordinary answer,
   * on every channel, on every page whose document never went through `withGeneratedSamples`, and
   * on every operation whose request all fifteen can express.
   */
  readonly codeSamplesRefused: readonly CodeSampleRefusalModel[];
  /**
   * What a reader has to know about the samples that are drawn, per SPEC 18.
   *
   * REQUIRED FOR THE REASON THE TWO MEMBERS ABOVE ARE, and orthogonal to both of them. Those three
   * account for every language the generator was asked about; this says what is true of the ones
   * that ended up with a tab. The empty list is the ordinary answer, on every channel, on every
   * page whose document never went through `withGeneratedSamples`, and on every operation whose
   * credential travels in a header and whose clients agree with the console.
   */
  readonly codeSamplesNotes: readonly CodeSampleNoteModel[];
  /**
   * What the try-it console needs to send this operation, or null for a channel.
   *
   * The projection travels with the page rather than the IR, which is what lets a console work
   * on a static file. It carries no credential and never will: those live in the runner, behind
   * the storage policy of SPEC 14.4, and a page that carried one would be a page that published
   * it.
   */
  readonly run: RunnerOperationView | null;
  /**
   * What a channel page is about, or null when the node is an HTTP operation, per SPEC 11.
   *
   * REQUIRED AND NULLABLE, the shape `run` and `runtime` already have on this interface. A
   * channel is a node under the `channel` discriminant, so its page is the node page and not a
   * ninth `PageKind`; what it needs that an operation does not is here, in one member, so a
   * theme asks one question rather than seven.
   *
   * SERVER DRAWN AND REDACTED IN TRANSIT, per SPEC 12: the three sections it feeds are adopted
   * positions, so the serializer writes null here and `drawn` beside it is what the client
   * walks. The highlighted source of an Avro payload never crosses.
   */
  readonly channel: ChannelModel | null;
  /**
   * What the running application knows about this operation, or null when nothing does.
   *
   * NULL RATHER THAN AN EMPTY BLOCK, per SPEC 6.3. A reader arriving from plain
   * `@nestjs/swagger` has registered no collectors, and a page of labelled slots with dashes in
   * them reads as a broken product rather than as a feature nobody switched on.
   */
  readonly runtime: RuntimeModel | null;
}

/**
 * One value on a runtime row.
 *
 * Every field is present and empty rather than absent, so the component tests one thing per
 * field instead of narrowing a union.
 *
 * THE PROVENANCE ARRIVES AS THE TWO FACTS AND NOT AS THE THREE STRINGS DRAWN FROM THEM, which is
 * what makes `ProvenanceTag` the one slot of the registry whose props survived the restatement
 * unchanged. The code, the class and the tooltip are the default component's answer to
 * `confidence` and `collector`; a theme that wants other letters overrides the slot rather than
 * reading a class name the reference happens to write. `confidence` is null when the value
 * carries no provenance, which is the source row: V8 either answered or did not, and SPEC 6.3
 * gives it no collector for that reason.
 */
export interface RuntimeValueModel {
  /** Status code of an error contract, drawn before the text. Empty on every other row. */
  readonly status: string;
  /** Whole class of the status code, so the two columns colour a code the same way. */
  readonly statusClass: string;
  readonly text: string;
  /** Where the text links to. Empty when the value is not a link. */
  readonly href: string;
  /** A short aside after the text: an error's detail, or why there is no source link. */
  readonly note: string;
  /** Level of the fact, per SPEC 6.1, or null when the value carries no provenance. */
  readonly confidence: IRConfidence | null;
  /** Collector that produced it. Empty exactly when `confidence` is null. */
  readonly collector: string;
}

/**
 * What one row of the runtime block is about.
 *
 * THE KIND IS THE SUPPORTED WAY TO TELL THE ROWS APART, and it is here because the alternative
 * was matching on the label. A theme that told an error row from a scope row by comparing
 * English is a theme that breaks when the wording changes, and the wording changed twice in M1.
 *
 * THE THREE ERROR GROUPS ARE THREE KINDS AND NOT ONE, which is T021's decision carried into this
 * field. A promise, an observation and a host wide list are different statements, and a single
 * `errors` kind would let a theme concatenate them without deciding to.
 */
export type RuntimeRowKind =
  | 'guards'
  | 'guards-global'
  | 'scopes'
  | 'roles'
  | 'rate-limit'
  | 'streaming'
  | 'errors-declared'
  | 'errors-runtime-derived'
  | 'errors-global'
  | 'source';

/** One labelled row of the runtime block. */
export interface RuntimeRowModel {
  readonly kind: RuntimeRowKind;
  readonly label: string;
  readonly values: readonly RuntimeValueModel[];
}

/** One finding, as a row. */
export interface DriftModel {
  readonly rule: IRDriftRule;
  /** Display code of the rule, per the SPEC 7.1 table. The kebab id stays the identifier. */
  readonly code: string;
  /** Class carrying the severity, which the design names crit, warn and note. */
  readonly severityClass: string;
  readonly message: string;
  /** What each side says, already labelled, so the component draws a list and not two cases. */
  readonly sides: readonly string[];
  readonly suggestion: string;
  /** Where the subject is. Empty on the page that is already about the subject. */
  readonly href: string;
  /** What the finding is about, for a row on a page that is not about it. Empty otherwise. */
  readonly subject: string;
}

/**
 * Which subject one row of the parity scale compares, in the order the scale draws them.
 *
 * THE SET IS THE DESIGN'S ELEVEN AND NOT THE FACT LIST'S SEVEN. Four rows have no runtime fact
 * behind them until their collectors exist, and they are rows all the same: the empty side is
 * drawn hatched with the reason, per SPEC 6.3, so the scale is complete from the first day and
 * fills in as collectors arrive.
 */
export type ParityRowKind =
  | 'authentication'
  | 'scopes'
  | 'roles'
  | 'rate-limit'
  | 'response-codes'
  | 'required-headers'
  | 'validation'
  | 'timeout'
  | 'streaming'
  | 'unread-parameters'
  | 'source';

/**
 * The gutter's answer for one row.
 *
 * `match` only where the row's SPEC 7.1 rule examined the operation and stayed quiet, `drift`
 * only where a finding is recorded, `unknown` everywhere a comparison did not run: no fact, no
 * rule for the row yet, or a document nothing measured. The glyphs are the component's.
 */
export type ParityVerdict = 'match' | 'drift' | 'unknown';

/** One side of a parity row that carries no provenance, which is the specification's. */
export interface ParitySideModel {
  /** Main line of the cell. */
  readonly value: string;
  /** Second line under it. Empty when there is nothing to add. */
  readonly note: string;
}

/** The remedy strip under a drifted row, per SPEC 7.1 and 7.4. */
export interface ParityFixModel {
  /** Same severity vocabulary as {@link DriftModel.severityClass}. */
  readonly severityClass: string;
  /** The finding's own suggestion, which SPEC 7.2 makes a contract rather than decoration. */
  readonly text: string;
  /** Display code of the rule, per the SPEC 7.1 table. */
  readonly code: string;
  /** Where the code links: the rule's group in the Health panel. */
  readonly href: string;
}

/**
 * One row of the parity scale: what the specification declares, what the application does, and
 * the verdict between them.
 *
 * THE RUNTIME SIDE IS THE SAME VALUE SHAPE THE LABELLED ROWS USE, so a theme that already reads
 * {@link RuntimeValueModel} reads a cell the same way. `runtime` empty and `reason` non-empty is
 * the drawn absence: the hatched cell with the phrase naming why the side is empty, which is the
 * design's answer for a missing side and not a placeholder.
 */
export interface ParityRowModel {
  readonly kind: ParityRowKind;
  readonly label: string;
  readonly spec: ParitySideModel;
  readonly runtime: readonly RuntimeValueModel[];
  /** Why the runtime side is empty. Empty exactly when `runtime` has values. */
  readonly reason: string;
  readonly verdict: ParityVerdict;
  /** Severity of the recorded finding. Empty unless `verdict` is `drift`. */
  readonly severityClass: string;
  /** The remedy strip. Null unless `verdict` is `drift`. */
  readonly fix: ParityFixModel | null;
}

/**
 * What the runtime knows about one response code, joined to the responses block.
 *
 * BUILT FROM THE ERROR CONTRACTS AND NOT A NEW FACT, per `TX-MARKUP`: a documented row that a
 * contract backs carries the contract's own provenance, and a code the runtime knows that the
 * specification does not carry becomes a full row flagged undocumented. A code both groups
 * know keeps the highest confidence, declared over derived over inferred, because a person's
 * declaration outranks a derivation about the same code.
 */
export interface ResponseMarkModel {
  readonly statusCode: string;
  /** Same vocabulary as {@link RuntimeValueModel.statusClass}. */
  readonly statusClass: string;
  /** The contract's title, drawn on an undocumented row where no description exists. */
  readonly title: string;
  readonly confidence: IRConfidence;
  readonly collector: string;
  /** True when the specification does not carry the code, which flags the row. */
  readonly undocumented: boolean;
}

/**
 * One item of the error contracts grid: one contract, or several that say the same thing.
 *
 * CONTRACTS SHARING DETAIL, TYPE, CONFIDENCE AND COLLECTOR MERGE INTO ONE ITEM with joined
 * codes, which is how 401 and 403, derived from one guard fact, print their shared sentence
 * exactly once, per SPEC 6.4 and the `demo-surface` pin. The contract itself keeps its own
 * fields: the merge is presentation, and a finding still travels one contract at a time.
 */
export interface ErrorContractItemModel {
  /** The codes, joined: `401, 403`. */
  readonly status: string;
  /** Class of the first code, so the chip colours the way the responses block colours it. */
  readonly statusClass: string;
  /** The titles, joined the way the codes are. */
  readonly title: string;
  /** RFC 9457 `type` URI, empty when the contract declares none. */
  readonly typeUri: string;
  /** The shared explanation, empty when the contract carries none. */
  readonly detail: string;
  /** Display name of the schema the contract answers with, empty when it names none. */
  readonly schemaLabel: string;
  /** The schema's own page, when the contract names a schema that has one. Empty otherwise. */
  readonly schemaHref: string;
  readonly confidence: IRConfidence;
  readonly collector: string;
}

/** One group of the error contracts grid, per SPEC 6.4. */
export interface ErrorContractGroupModel {
  /** The same three kinds the labelled rows use, so a theme tells groups apart one way. */
  readonly kind: RuntimeRowKind;
  /** The group's head, in the reader's words. */
  readonly label: string;
  /** The line under the head, saying where contracts of this group come from. */
  readonly sub: string;
  readonly items: readonly ErrorContractItemModel[];
  /**
   * The sentence an empty group states, per SPEC 6.4. Only the declared group survives being
   * empty, because it is the group a person writes; for the other two this is always empty
   * and the group is not built.
   */
  readonly empty: string;
}

/** The runtime block of one node. */
export interface RuntimeModel {
  readonly rows: readonly RuntimeRowModel[];
  readonly drift: readonly DriftModel[];
  /**
   * The parity scale of an operation page, per SPEC 6.3, in the design's row order.
   *
   * Empty for a channel, which keeps the labelled row block until M5 designs one, and a
   * component that finds it empty draws `rows` the way it always did.
   */
  readonly parity: readonly ParityRowModel[];
  /**
   * What the runtime knows per response code, joined to the responses block, per `TX-MARKUP`.
   *
   * Empty when no error collector ran, and the responses block then draws what the document
   * declares and nothing else, which is every page before M1.
   */
  readonly responseMarks: readonly ResponseMarkModel[];
  /**
   * The error contracts grid, per SPEC 6.4 and `TX-MARKUP`: the groups worth drawing, in the
   * declared, derived, global order. Empty exactly when no error collector ran.
   */
  readonly contracts: readonly ErrorContractGroupModel[];
}

/** One line of the check list, which is one question asked of the whole document. */
export interface HealthCheckModel {
  readonly label: string;
  /** `124 / 127`, or `n/a` for a check nothing in this document could be asked. */
  readonly count: string;
}

/**
 * Everything one rule found, which is what the panel lists.
 *
 * A RULE THAT EXAMINED AND FOUND NOTHING IS A ROW WITH NO FINDINGS, since `TX-PARITY-UI`: the
 * panel draws it muted with its zero, never as a disabled control, because a disclosure with
 * nothing to disclose is the F14 class. A rule that never examined anything is not in the
 * list at all, per SPEC 7.3's null-against-zero.
 */
export interface HealthRuleModel {
  readonly rule: IRDriftRule;
  /** Display code of the rule, per the SPEC 7.1 table. Since `TX-PARITY-UI`, so a silent rule has one without a finding to borrow it from. */
  readonly code: string;
  /** The rule's own sentence, its catalogue label, so no second vocabulary exists to drift. */
  readonly summary: string;
  /** Severity class of the rule, the {@link DriftModel.severityClass} vocabulary. */
  readonly severityClass: string;
  /** How many findings the rule produced, as the closed group prints it. */
  readonly count: string;
  readonly findings: readonly DriftModel[];
}

/** The KPI triple of the health page head, per the layout and `TX-PARITY-UI`. */
export interface HealthKpiModel {
  /** Operations the report measured, which is `IRHealthReport.operationCount`. */
  readonly operations: number;
  /** Findings at `error` severity. */
  readonly critical: number;
  /** Findings at `warning` severity. */
  readonly warnings: number;
}

/** The Health panel of SPEC 7.2, which the health page carries. */
export interface HealthModel {
  /** Heading of the panel, carrying what was asked and how much came back. */
  readonly title: string;
  /** The percentage of SPEC 7.2, as it is printed. */
  readonly score: string;
  /** The head's triple, derived from the report, per `TX-PARITY-UI`. */
  readonly kpi: HealthKpiModel;
  readonly checks: readonly HealthCheckModel[];
  readonly rules: readonly HealthRuleModel[];
}

/**
 * Which page a reader has open.
 *
 * EIGHT SINCE `T046`, per SPEC 13.3: the layout's tab pages are pages with addresses, not
 * anchors. `bench` is the console on its own address, `health` the report page, `shapes` and
 * `states` the showcase pages, in the bar since `TX-PARITY-UI` per the maintainer's
 * 2026-08-14 reversal of the session 55 exclusion. `service` is the federated service card of
 * SPEC 15.3, which entered this union exactly when M4 gave the page a renderer, the way an SP
 * code is not assigned before its rule exists; the widening is a breaking change by the
 * CONTRACT.md union rule and is recorded there. It is not a tab: the card is reached from the
 * navigation's service groups, so {@link FrameTabKind} stays six.
 */
export type PageKind =
  'overview' | 'node' | 'schema' | 'bench' | 'health' | 'shapes' | 'states' | 'service';

/**
 * Which tab of the frame's bar a target belongs to.
 *
 * SIX SINCE `TX-PARITY-UI`, per the prototypes: the bar is six constant items and the two
 * showcase pages entered it, reversing the session 55 exclusion by the maintainer's
 * 2026-08-14 decision. The SPEC 13.3 rule survives through remembering rather than through
 * hiding: the client records the operation tabs and merges them back on the pages that have
 * none of their own, per SPEC 11.
 */
export type FrameTabKind = 'node' | 'schema' | 'shapes' | 'bench' | 'health' | 'states';

/**
 * One tab of the frame's bar, with its target already resolved.
 *
 * THE HREF IS BUILT BY THE RENDERER AND NOT BY THE SHELL, for the reason `links.ts` exists: a
 * theme that derived addresses itself would be a second spelling of every path, and a broken
 * link neither side's tests would see. The label is the component's answer to `kind`, so a
 * theme is never matching on English.
 */
export interface FrameTabModel {
  readonly kind: FrameTabKind;
  readonly href: string;
  /** True on the tab whose page this is. */
  readonly active: boolean;
  /**
   * Findings behind the tab: the operation's own on `node`, the document's on `health`.
   * Zero draws no figure, per the {@link NavEntryModel.driftCount} rule.
   */
  readonly count: number;
}

/** The rail's stats row: what the whole document holds, not what this page carries. */
export interface FrameStatsModel {
  /** Addressable nodes of the document, operations and channels alike. */
  readonly operations: number;
  /** Top level navigation groups, the schema registry group among them. */
  readonly groups: number;
  /**
   * Findings of the health report, or null on a document nothing measured.
   *
   * NULL AND ZERO ARE DIFFERENT STATEMENTS, per SPEC 7.3: zero is a measured clean document
   * and draws its figure; null is the absence of a report and draws nothing.
   */
  readonly drift: number | null;
}

/**
 * The frame of one page: what the app bar and the rail say, per SPEC 11 and `TX-FRAME`.
 *
 * A TAB WITHOUT A RESOLVABLE TARGET IS NOT IN THE SERVED LIST, per SPEC 11: a channel has no
 * bench, and a document page has no operation tabs of its own. Since `TX-PARITY-UI` the bar
 * is six constant items by remembering rather than by hiding: the client records the
 * operation tabs on an operation page and merges them back on the pages that have none, so
 * every href in this list, stored or fresh, is one the server resolved.
 */
export interface FrameModel {
  readonly tabs: readonly FrameTabModel[];
  /** Breadcrumb of the current node, `Orders / GET /orders`. Empty on document pages. */
  readonly crumb: string;
  /** Where back leads: the operation for its bench, the schema for its shapes, else the overview. Empty on the overview itself. */
  readonly backHref: string;
  readonly stats: FrameStatsModel;
}

/**
 * The generated static proxy of SPEC 16.2, as the page carries it.
 *
 * TWO FACTS BECAUSE A REWRITE RULE IS TWO FACTS. Where the rules live, and which upstream each
 * one serves: the build wrote one rule per pinned upstream at `<prefix>/u<N>/`, indexed by
 * position, so a console that knows only the prefix knows no rule's address. The order is the
 * contract, not a presentation detail.
 */
export interface StaticProxyModel {
  /** Absolute path on this origin every rule lives under, `<base>/_proxy`. */
  readonly prefix: string;
  /** The pinned upstreams, in the `u<N>` order the generated rules index them by. */
  readonly upstreams: readonly string[];
}

/** Everything one page renders from. */
export interface PageModel {
  readonly pageModelVersion: number;
  /**
   * Which page this is, stated rather than derived.
   *
   * Until `TX-FRAME` the kind was derived from which of `node` and `schema` is set, and the
   * bench page broke the derivation: it carries the node the way the node page does and draws
   * the console instead of the sections.
   */
  readonly kind: PageKind;
  /** The app bar and rail of this page, per SPEC 11. */
  readonly frame: FrameModel;
  readonly documentId: string;
  readonly documentHash: string;
  readonly title: string;
  readonly version: string;
  readonly descriptionHtml: string;
  /** Where the reference is mounted, without a trailing slash. */
  readonly basePath: string;
  readonly servers: readonly string[];
  /** The navigation this page carries, which is a slice of the document's. */
  readonly navigation: readonly NavEntryModel[];
  /** True when `navigation` is the whole of it, so nothing is fetched and nothing is missing. */
  readonly navigationComplete: boolean;
  /** Rows in the whole navigation, so the sidebar can say what it is not showing. */
  readonly navigationRows: number;
  readonly activeNodeId: string | null;
  /** Set on a schema page, so the navigation can mark the entry that is open. */
  readonly activeSchemaId: string | null;
  /** Null on the overview page, which shows the document rather than a node. */
  readonly node: NodeModel | null;
  /** Set only on a schema page. */
  readonly schema: SchemaPageModel | null;
  /** Set only on a federated service card, per SPEC 15.3. */
  readonly service: ServicePageModel | null;
  /** The schemas this page carries, bounded per the payload limit. */
  readonly schemas: Readonly<Record<string, IRSchema>>;
  /** Ids referenced from this page and left behind by the bound, shown as links. */
  readonly truncatedSchemas: readonly string[];
  /**
   * The Health panel of SPEC 7.3, carried by the overview page and by no other.
   *
   * IT IS DRAWN BY THE SERVER AND IT DOES NOT TRAVEL, per SPEC 7.2. The serializer writes null
   * here whatever the report is, and `healthRendered` beside it is what the client reads.
   */
  readonly health: HealthModel | null;
  /** Whether the server drew a panel, which is the whole of what the client needs to know. */
  readonly healthRendered: boolean;
  /**
   * The topology graph of SPEC 9, carried by the overview page and by no other.
   *
   * REQUIRED AND NULLABLE, the shape `NodeModel.channel` already has one interface down: null on
   * every page that is not the overview and on an overview whose document declares no edge, a
   * value on the one page that draws the graph. Optional would have meant a producer could forget
   * it and a consumer could not tell "no edges" from "nobody looked", which is the distinction
   * this whole feature is about.
   *
   * IT IS `IRTopology` AND NOT A PAGE MODEL TYPE RESTATING IT, which is the one place this file
   * departs from its own rule that the IR does not travel. The rule exists because an IR shape is
   * unbounded: a schema drags its whole subtree and `AppShell` asking for an `IRDocument` was
   * measured at 1.6 MB on one corpus document. `IRTopology` is not that shape. It is already a
   * projection, built by `buildTopology` in `@openref/core` for this purpose, plain JSON with no
   * `Map` and no schema in it, bounded by the number of declared edges; restating it here would
   * be a second copy of six fields whose only job would be to go stale.
   *
   * SERVER DRAWN AND REDACTED IN TRANSIT, per SPEC 12, exactly as `health` above is. The overview
   * position is server resolved and the browser adopts its markup, so the serializer writes null
   * here and the client never reads a graph it does not draw.
   */
  readonly topology: IRTopology | null;
  /**
   * The same origin proxy endpoint of SPEC 14.5, when the host turned the proxy on.
   *
   * An absolute path on this origin, `<mount>/_proxy`, and the fact the runner factory reads
   * to choose the proxy transport over the direct one. Absent when the host serves no proxy,
   * so a page without one carries no bytes for it and the console sends directly, which is the
   * same build it always was.
   */
  readonly proxyPath?: string;
  /**
   * Name of the deployment platform that cannot rewrite routes, per SPEC 16.2, shown to the
   * reader beside the console.
   *
   * Set by the static build when `--target` named a platform with no rewrite capability and the
   * document pins at least one absolute upstream, so the console warns that requests go straight
   * from the reader's browser to the API. Absent everywhere else: a served page and a build with
   * a working proxy target have nothing to warn about, and a direct request to the page's own
   * origin is not a degradation.
   */
  readonly directTarget?: string;
  /**
   * The generated proxy rules of SPEC 16.2, when the build wrote them for this site.
   *
   * Set by the static build when `--target` named a platform that can rewrite routes and the
   * document pinned at least one absolute upstream, so the console sends to this page's own
   * origin under the prefix and the platform reaches the API. Absent everywhere else: a served
   * page carries `proxyPath` for the envelope proxy instead, and a build with no rules has no
   * rule to address. The two are never both set, because one host mounts a route and the other
   * generates a rewrite, and no deployment is both.
   */
  readonly staticProxy?: StaticProxyModel;
}

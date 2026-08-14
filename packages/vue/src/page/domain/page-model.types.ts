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
   * The second line: `METHOD /path` for an operation, the address for a channel, empty for a
   * group.
   *
   * It exists because the label is the operation's summary when it has one, and a reader
   * searching for `/orders/{id}` would otherwise find nothing on a document whose authors
   * wrote summaries. It is what the command palette matches on as well as shows.
   */
  readonly hint: string;
  /**
   * Children this entry has in the whole navigation, which is not what it carries.
   *
   * A page ships the navigation it can draw and nothing else, so a closed group arrives with an
   * empty `children` and a count above zero. The two together are what let the sidebar render a
   * group as openable without holding what is inside it, and what let it tell a closed group
   * from an empty one, which look identical from `children`.
   */
  readonly childCount: number;
  readonly children: readonly NavEntryModel[];
}

/**
 * One row of the search overlay.
 *
 * IT IS THE PALETTE'S OWN ROW AND NOT A `SearchHit`. The shipped palette searches the navigation
 * slice and never consults the search port, so the method and the path arrive joined into one
 * `hint` string rather than apart. A prop declared as `SearchHit` would be a prop the position
 * cannot supply.
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
}

/** One media type of a body or a response, with its example already highlighted. */
export interface MediaTypeModel {
  readonly mediaType: string;
  readonly typeLabel: string;
  /** Highlighted example, empty when the media type is not one an example is generated for. */
  readonly exampleHtml: string;
  /** Where the schema viewer starts for this media type, null when it declares no schema. */
  readonly schema: IRSchemaSlot | null;
  /** Which half of a schema this position shows, so the viewer filters the same way. */
  readonly view: IRSchemaView;
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
}

/** One response row. */
export interface ResponseModel {
  readonly statusCode: string;
  readonly descriptionHtml: string;
  readonly content: readonly MediaTypeModel[];
}

/** One security requirement, resolved against the document's schemes. */
export interface SecurityModel {
  readonly schemeId: string;
  readonly type: string;
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
 * The head of a node page: what the operation is, and nothing about what it carries.
 *
 * SEPARATE FROM {@link NodeModel} BECAUSE THE HEADER POSITION IS HANDED THIS AND NOT THAT. The
 * value that arrives is the page's own node model, which extends this, so nothing is copied per
 * render; what the contract promises is these eight fields, and a theme that reads more than it
 * was promised is reading something that may move.
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
}

/** The node a page is about. */
export interface NodeModel extends NodeHeaderModel {
  readonly descriptionHtml: string;
  readonly tags: readonly string[];
  readonly parameters: readonly ParameterModel[];
  readonly requestBody: readonly MediaTypeModel[];
  readonly responses: readonly ResponseModel[];
  readonly security: readonly SecurityModel[];
  /** Call samples the document wrote, per SPEC 18. Empty when it wrote none. */
  readonly codeSamples: readonly CodeSampleModel[];
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

/** The runtime block of one node. */
export interface RuntimeModel {
  readonly rows: readonly RuntimeRowModel[];
  readonly drift: readonly DriftModel[];
}

/** One line of the check list, which is one question asked of the whole document. */
export interface HealthCheckModel {
  readonly label: string;
  /** `124 / 127`, or `n/a` for a check nothing in this document could be asked. */
  readonly count: string;
}

/** Everything one rule found, which is what the panel lists. */
export interface HealthRuleModel {
  readonly rule: IRDriftRule;
  /** How many findings the rule produced, as the closed group prints it. */
  readonly count: string;
  readonly findings: readonly DriftModel[];
}

/** The Health panel of SPEC 7.2, which the overview page carries. */
export interface HealthModel {
  /** Heading of the panel, carrying what was asked and how much came back. */
  readonly title: string;
  /** The percentage of SPEC 7.2, as it is printed. */
  readonly score: string;
  readonly checks: readonly HealthCheckModel[];
  readonly rules: readonly HealthRuleModel[];
}

/** Which of the three pages a reader has open. */
export type PageKind = 'overview' | 'node' | 'schema';

/** Everything one page renders from. */
export interface PageModel {
  readonly pageModelVersion: number;
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
   * The same origin proxy endpoint of SPEC 14.5, when the host turned the proxy on.
   *
   * An absolute path on this origin, `<mount>/_proxy`, and the fact the runner factory reads
   * to choose the proxy transport over the direct one. Absent when the host serves no proxy,
   * so a page without one carries no bytes for it and the console sends directly, which is the
   * same build it always was.
   */
  readonly proxyPath?: string;
}

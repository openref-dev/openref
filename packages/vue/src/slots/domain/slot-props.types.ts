import type { IRConfidence, IRSchema, IRSchemaView } from '@openref/core';
import type {
  CodeSampleModel,
  DriftModel,
  ErrorContractGroupModel,
  FrameModel,
  FrameStatsModel,
  HealthModel,
  NavEntryModel,
  NodeHeaderModel,
  PageKind,
  PaletteHitModel,
  ParameterModel,
  ResponseMarkModel,
  ResponseModel,
  RuntimeModel,
  SchemaPageModel,
} from '../../page/domain/page-model.types';
import type {
  RunnerBodyMediaTypeView,
  RunnerDeviceAuthorization,
  RunnerFile,
  RunnerOAuthFlowView,
  RunnerResult,
  RunnerSecuritySchemeView,
  RunnerSessionStatus,
  RunnerStreamElement,
  RunnerStreamEnd,
} from '../../runner/application/ports/runner.port';
import type { SchemaTreeNode } from '../../state/domain/schema-expansion';
import type { StateNoticeKind, StreamCounts } from './slot-value.types';

/**
 * The fixed slot registry, per SPEC 10.4 and `ai-docs/design/CONTRACT.md`.
 *
 * These props are public API. A theme written against them keeps working until a major
 * version, which is the whole point of the L1 level: replace a piece of markup without
 * forking the reference. `slot-contract.spec.ts` pins every entry at the type level, so
 * changing one fails compilation rather than silently breaking a theme downstream.
 *
 * The set is fixed rather than open on purpose. An open set of slots is an open contract, and
 * an open contract cannot be frozen.
 *
 * A SLOT IS A COMPONENT, NOT A REGION OF A PAGE. The registry named page regions until the
 * design handoff, and the three reference themes are what settled it: vernier puts the
 * specification and the runtime in two equal columns with a ruler between them, telltale puts
 * the runtime block ahead of the specification, forge is a code host with tabs. A name like
 * `operation.parameters` denotes a different position in each of those layouts, which is to
 * say it denotes nothing that survives a layout change. A component name survives one, so the
 * registry names components and the layouts are free to place them.
 *
 * EVERY PROP IS DECLARED IN TERMS OF WHAT THE RENDERER CAN HAND OVER AT THE POSITION IT DRAWS,
 * and that rule is what the registry was restated against in `TX-SLOTWIRE`. Three sources
 * qualify, and the browser has all three: the page model and its sub-models, the runner's own
 * view of an operation and what its port answers with, and the component's own state. The IR
 * does not qualify. `AppShell` declared `document: IRDocument`, and that document canonically
 * serialized is 1,612,858 bytes on `twilio-api-v2010.yaml` against a node page's whole state
 * block of 23,153: seventy times the page. A prop that cannot be supplied at any price is a
 * contract with nothing behind it, and twelve of the twenty five were in that state.
 *
 * WHERE A DECLARED PROP IS A SUPERTYPE OF WHAT ARRIVES, THE CONTRACT IS THE SUPERTYPE.
 * `OperationHeader.node` is a {@link NodeHeaderModel} and the value handed is the page's own
 * {@link import('../../page/domain/page-model.types').NodeModel}, which extends it. Narrowing it
 * would allocate a copy of ten fields on every render of every page to hide fields a theme has
 * no reason to read; what is promised is what is declared, and reading past it reads something
 * that may move.
 *
 * TWO POSITIONS RUN ONLY ON THE SERVER, AND ONE OF THEM IS A SLOT. `HealthScore` is resolved
 * during the server render, from {@link HealthModel}, and whatever it draws is what the reader
 * receives; the browser fills that position with an element that adopts the markup already under
 * it, per SPEC 7.2 and 12, so a component with client state there receives nothing, because
 * nothing on the client draws it. It does not generalise: every other position renders on the
 * server AND re-renders in the browser from the state block, which is what hydration is.
 *
 * WHAT IS NOT HERE, AND WHY, BECAUSE SOMEBODY WILL PROPOSE EACH OF THEM AGAIN.
 *
 * - `ErrorContract`. The three groups of SPEC 6.4 are three labelled rows of the runtime block,
 *   and since `TX-MARKUP` the grid on the operation page is drawn by the `ResponseList` default
 *   from `contracts` on its props. Neither gets a slot of its own: giving them one undoes
 *   T023's measured decision that the block is one list of labelled rows and not five shapes,
 *   which was worth 1.4 KB of the first paint. A theme varies errors by overriding
 *   `RuntimePanel` or `ResponseList`, and it tells an error row from a scope row by
 *   `RuntimeRowModel.kind`, which exists for that and is the supported way. Matching on the
 *   label is matching on English, and the English changed twice in M1
 * - `BranchPicker`, `PatternKeys`, `TupleField`. The tree draws variants, pattern properties and
 *   prefix items as ordinary rows through one expander, and `SchemaTreeNode.relation` already
 *   carries the distinction to whoever overrides `SchemaTree`. That field is the supported way to
 *   tell the three apart, for the same reason `kind` is on a runtime row. Three names for three
 *   row kinds of one component would have been three slots no page ever resolved
 * - `RuleFilter`. The Health panel filters with `details` and `summary`, which the user agent
 *   opens. A script filter was refused at T023 for the first paint and for the strict CSP, and a
 *   theme that wants one overrides `HealthScore`
 * - `ThemeToggle`. There is no control, and the position is not cheap. The scheme is a shell
 *   option the host writes plus `prefers-color-scheme`, which is what T009 built. A stored
 *   preference cannot enter the server render, because that render is cached by document hash
 *   per SPEC 12 and one reader's preference would be served to the next; and it cannot be applied
 *   before first paint without an inline script, which SPEC 19 forbids and which is a declared
 *   competitive advantage of this project. So a toggle means a flash of the wrong scheme for
 *   every reader whose stored preference differs from their system one. That is a product
 *   decision with a cost, not wiring, and it is written here rather than only in the removal so
 *   that the answer to the next proposal is the reason and not "we forgot"
 */
export interface SlotPropsMap {
  /**
   * The whole page: header, navigation rail, content column, and the order of the blocks
   * inside it. Replaced by an L2 theme.
   *
   * THE CONTENT ARRIVES AS CHILDREN AND NOT AS DATA. A shell that took the page would be a
   * second renderer, and the three reference themes disagree about where the blocks go rather
   * than about what they say. Block order is the shell's business for the same reason: a slot
   * per region would have frozen one theme's answer into the contract.
   *
   * `defineTheme.layout` IS THIS POSITION BY ANOTHER NAME AND RESOLVES INTO IT. It stays as the
   * authoring surface, because `layout: () => import('./Layout.vue')` reads better than a
   * component in a map; `resolveTheme` turns it into this slot, and a theme that declares both is
   * refused. Two mechanisms for one position is the defect that produced `TX-SLOTWIRE`, in
   * miniature.
   */
  AppShell: {
    title: string;
    version: string;
    basePath: string;
    activeNodeId: string | null;
    activeSchemaId: string | null;
    page: PageKind;
    /**
     * The app bar's data, since `TX-FRAME`: the tabs with targets resolved, the breadcrumb,
     * where back leads, and the rail statistics. Additive, minor per `PUBLIC-API.md`: a shell
     * written before it keeps compiling and keeps rendering; a shell that draws a bar reads
     * this rather than deriving addresses, which would be a second spelling of every path.
     */
    frame: FrameModel;
  };

  /** Tree of operations and channels, with the item rendering inside it. */
  NavTree: {
    entries: readonly NavEntryModel[];
    activeNodeId: string | null;
    activeSchemaId: string | null;
    basePath: string;
    /**
     * The stats row above the tree, since `TX-FRAME`: the document's counts, not the slice's.
     * Additive, minor per `PUBLIC-API.md`. `drift` is null on a document nothing measured,
     * and null draws nothing, per SPEC 7.3.
     */
    stats: FrameStatsModel;
    /** True when these entries are the whole navigation, so nothing is fetched. */
    complete: boolean;
    /** Rows in the whole navigation, so a partial tree can say what it is not showing. */
    total: number;
    /**
     * Fetches the rest of the navigation, once.
     *
     * A group whose children never travelled with the page cannot open without this, and the
     * answer is false when there is nothing to fetch or when the fetch failed, which is what a
     * tree draws its `nav-unavailable` notice from.
     */
    load(): Promise<boolean>;
  };

  /** The search overlay: the field, the results, and the empty and no-results states. */
  CommandPalette: {
    open: boolean;
    query: string;
    /** Index of the row the arrows have selected. */
    selected: number;
    hits: readonly PaletteHitModel[];
    /** True while the page is searching the slice it shipped with rather than the whole index. */
    partial: boolean;
    onOpen(): void;
    onClose(): void;
    onQuery(query: string): void;
    /** Moves the selection, which the arrow keys do and the host holds. */
    onSelect(index: number): void;
  };

  /**
   * The document overview: the title, what the document says about itself, and its servers.
   *
   * THE HEALTH PANEL IS NOT HERE SINCE `TX-FRAME`: it lives on the health page, per SPEC 7.3
   * as amended 2026-08-14, and the frame's health tab is how a reader reaches it. The panel
   * position stays `HealthScore`, resolved on the page that draws it.
   */
  DocumentOverview: {
    title: string;
    descriptionHtml: string;
    servers: readonly string[];
    basePath: string;
  };

  /**
   * One named schema on a page of its own, with the tree arriving as children.
   *
   * The page exists because the navigation ends in a `Schemas` group and because a schema too far
   * from a use site to travel with the page is shown by linking to it.
   */
  SchemaPage: { schema: SchemaPageModel; basePath: string };

  /**
   * Method, path, summary and the discrepancies found against the running application.
   *
   * `benchHref` since `TX-MARKUP`: where the header's primary button leads, empty exactly when
   * the frame draws no bench tab, so the two never disagree about whether a bench exists. The
   * header draws the kicker from `node.tags` and `node.operationId` and the drift box from
   * `drift.length`; the count is the design's box, and the detail stays in the FixBar.
   */
  OperationHeader: { node: NodeHeaderModel; drift: readonly DriftModel[]; benchHref: string };

  /**
   * Runtime facts about one node, each with where it came from.
   *
   * Keyed by node id rather than by an operation view, because a channel has runtime facts on
   * the same shape and this panel does not care which kind of node it is looking at.
   *
   * `available` IS GONE AND ITS ABSENCE IS THE ANSWER. SPEC 6.3 draws no block at all for a node
   * with no facts rather than an empty one, so this position is not rendered, and a flag saying
   * so would have been a flag no page ever set to false.
   */
  RuntimePanel: { nodeId: string; runtime: RuntimeModel };

  /** The declared, derived or inferred mark on a single fact, per SPEC 6.1. */
  ProvenanceTag: { confidence: IRConfidence; collector: string };

  /** One finding: what the runtime says, what the specification says, and the fix. */
  DriftCard: { issue: DriftModel };

  /** Parameters of an operation, in the one order both surfaces print them in. */
  ParamTable: { parameters: readonly ParameterModel[] };

  /**
   * Response codes of an operation, with descriptions and examples already rendered, and the
   * error contracts under them.
   *
   * THE SCHEMA SLICE IS A PROP AND IT IS NOT AN IR PROP. A response body draws a tree under it,
   * and the tree expands from the bounded slice of schemas the page ships with rather than from
   * the document, which does not travel. Without the slice this position can draw a status code
   * and a sentence and nothing else.
   *
   * `marks` AND `contracts` SINCE `TX-MARKUP`, both empty when no error collector ran. The
   * merged list and the grid live in this position rather than in the page composition, so a
   * theme that owns the responses owns everything said about them, and the markup a complete
   * theme cannot replace does not grow.
   */
  ResponseList: {
    responses: readonly ResponseModel[];
    schemas: SchemaPayloadMap;
    /** Ids referenced from this page and left behind by the payload bound, shown as links. */
    truncated: readonly string[];
    basePath: string;
    /** What the runtime knows per code: the chip on a backed row, the row for an unknown one. */
    marks: readonly ResponseMarkModel[];
    /** The error contracts grid, per SPEC 6.4, in the declared, derived, global order. */
    contracts: readonly ErrorContractGroupModel[];
  };

  /**
   * Call samples, one tab per language, per SPEC 18.
   *
   * What a document writes under `x-codeSamples` is level 3 and has the highest priority, so it
   * is what this draws today. The generator of levels 1 and 2 is T057, in M6, and produces the
   * same shape, so a sample from the document and a sample from the generator are
   * indistinguishable to a theme.
   */
  CodeSample: {
    samples: readonly CodeSampleModel[];
    activeLang: string;
    onSelect(lang: string): void;
  };

  /**
   * The schema tree, one level at a time, with the viewer's own cycle stops.
   *
   * THE EXPANDER IS A PROP AND THE SCHEMA MAP IS NOT, which is a finding this registry was
   * restated to fix. `{ root, view }` alone lets a theme draw one level and stop: children come
   * from `expandSchemaNode(node, { schemas, view })` and the map was never in the props. Handing
   * the map instead would put a bounded slice of the document in the contract and make expansion
   * eager; handing the function keeps it lazy and keeps the map out.
   *
   * `SchemaTreeNode.relation` is what tells a variant, a pattern property and a prefix item apart,
   * and it is the supported way to do it.
   */
  SchemaTree: {
    root: SchemaTreeNode;
    view: IRSchemaView;
    expand(node: SchemaTreeNode): readonly SchemaTreeNode[];
    /** Ids referenced from this page and left behind by the payload bound, shown as links. */
    truncated: readonly string[];
    basePath: string;
    /** What the position is called: a media type, or the schema's own display name. */
    label: string;
    /**
     * Whether the root's label is the container's word rather than the schema's own.
     *
     * FINDING F15, AS A PROP, because only the caller knows it. A body block prints
     * `application/json` in its head and lends that word to the tree so the tree has a root to
     * draw, and printing it again on the root row is one position saying one thing twice. A
     * schema page's root is the schema, and its name is its own.
     */
    borrowedLabel: boolean;
    /**
     * Whether each row carries its permanent `#` link, per `TX-MARKUP`.
     *
     * The schema page turns it on; a tree under a response does not, because the fragment
     * namespace belongs to one tree per page and the schema page is that tree.
     */
    anchors: boolean;
    /**
     * The row a reader's fragment names, already decoded, or empty.
     *
     * On mount the tree expands the ancestors of this path level by level through the same
     * lazy expander and focuses the row: a permanent address opens the schema at the field.
     */
    anchor: string;
  };

  /**
   * Filling a request body whose shape depends on the values already entered.
   *
   * This is the input side of a request body. The read only documentation of the same body is
   * a {@link SlotPropsMap.SchemaTree} with `view: 'request'`.
   */
  ShapeForm: {
    media: RunnerBodyMediaTypeView;
    /** What has been typed into each named field, keyed by field name. */
    values: Readonly<Record<string, string>>;
    /** What has been chosen for each file field, keyed by field name. */
    files: Readonly<Record<string, RunnerFile>>;
    /** The whole body, for the media types whose editor is one text area. */
    text: string;
    onField(name: string, value: string): void;
    onFile(name: string, file: RunnerFile | undefined): void;
    onText(text: string): void;
  };

  /**
   * Credentials for the schemes an operation requires, and the sign in for the ones that have
   * one, per SPEC 14.4.
   */
  AuthPanel: {
    schemes: readonly RunnerSecuritySchemeView[];
    /** What has been typed into each scheme's credential field, keyed by scheme id. */
    credentials: Readonly<Record<string, string>>;
    /** Sign in form fields, keyed `<schemeId>:<field>`. Never stored, never rendered back. */
    inputs: Readonly<Record<string, string>>;
    /** Flows per scheme: the ones it declares, or the ones its discovery document answered. */
    flows: Readonly<Record<string, readonly RunnerOAuthFlowView[]>>;
    /** Flow chosen per scheme, keyed by scheme id. */
    chosenFlow: Readonly<Record<string, string>>;
    sessions: Readonly<Record<string, RunnerSessionStatus>>;
    /** What the last sign in said, keyed by scheme id. */
    notices: Readonly<Record<string, string>>;
    /** Device authorizations waiting on the reader, keyed by scheme id. */
    devices: Readonly<Record<string, RunnerDeviceAuthorization>>;
    /** Scheme a sign in is in flight for, or null. */
    pending: string | null;
    /** False until hydration has matched, which is what keeps a credential out of the markup. */
    mounted: boolean;
    onCredential(schemeId: string, value: string): void;
    onInput(schemeId: string, field: string, value: string): void;
    onFlow(schemeId: string, kind: string): void;
    onSignIn(schemeId: string): void;
    onSignOut(schemeId: string): void;
  };

  /**
   * Choice of server.
   *
   * THE SERVERS ARE URLS AND NOT `IRServer`, because the page model carries them as urls: the
   * reference has never drawn a server's description or its variables, so neither is on the wire.
   * Putting them back is a page model decision and not a slot one.
   */
  ServerSelect: {
    servers: readonly string[];
    activeServerUrl: string;
    onSelect(url: string): void;
  };

  /**
   * Sending the request.
   *
   * `onSend` IS THE PROP THAT MAKES IT A BUTTON. As declared before the restatement this slot had
   * three read only props and no callback, so an override could draw a control and not send with
   * it. `mounted` is false in the server render and in the first client render, and `notice` is
   * the sentence that goes with a button that cannot act, per SPEC 11 and finding F14.
   */
  SendButton: {
    available: boolean;
    pending: boolean;
    mounted: boolean;
    /** Why the button cannot act, or empty when it can. */
    notice: string;
    onSend(): void;
  };

  /**
   * Status, headers, body and timings of the last response.
   *
   * `declared` since `TX-MARKUP`: the status codes the document declares for this operation,
   * so the view can say whether the answer matches the declaration. Empty means no comparison
   * and no chip, because a verdict against nothing asserts nothing.
   */
  ResponseView: {
    result: RunnerResult | undefined;
    /** What the runner refused with, or undefined when it did not. */
    error: string | undefined;
    pending: boolean;
    declared: readonly string[];
  };

  /**
   * A streaming response as it arrives, per SPEC 14.6. Event channels populate it from M5.
   *
   * The window is bounded and the counts say what went past it, because a list that simply
   * started later would read as a stream that started later.
   */
  StreamLog: {
    elements: readonly RunnerStreamElement[];
    counts: StreamCounts;
    /** How the stream ended, or null while it is open or before it was opened. */
    end: RunnerStreamEnd | null;
    open: boolean;
    mounted: boolean;
    /** False in a build with no runner, or on a document with no server. */
    available: boolean;
    onStart(): void;
    onStop(): void;
  };

  /**
   * Documentation Health, per SPEC 7.2.
   *
   * THIS SLOT IS RESOLVED IN THE SERVER RENDER AND ITS COMPONENT MUST RENDER WITHOUT CLIENT
   * STATE. Whatever it draws is what the reader receives; the browser fills the position with an
   * element that adopts the markup rather than drawing it, so a component with client state here
   * receives nothing. It is the one server side slot of the registry, and the reason is SPEC 7.2:
   * the report does not travel.
   */
  HealthScore: { health: HealthModel };

  /** Empty and degraded states, which are content rather than an absence of it. */
  StateNotice: { kind: StateNoticeKind; message: string };
}

/**
 * The bounded slice of schemas a page ships with, keyed by id.
 *
 * IT IS ON THE WIRE AND THE DOCUMENT IS NOT. `buildSchemaPayload` walks breadth first from the
 * use sites of one page and stops at 128 KB, so what a position is handed is what is nearest to
 * what the reader is looking at. An id that was referenced and not shipped is in `truncated`
 * beside it, and is drawn as a link to that schema's own page.
 */
export type SchemaPayloadMap = Readonly<Record<string, IRSchema>>;

/** Name of a slot a theme may override. */
export type SlotName = keyof SlotPropsMap;

/** Props a given slot receives. */
export type SlotProps<TName extends SlotName> = SlotPropsMap[TName];

/**
 * Every slot name, in the order the design contract lists them.
 *
 * Declared as a tuple rather than derived from the type, because a runtime list is needed to
 * validate a theme, and a derived list would have no order. `SLOT_NAMES_ARE_COMPLETE` below
 * makes the two disagree at compile time rather than at runtime.
 */
export const SLOT_NAMES = [
  'AppShell',
  'NavTree',
  'CommandPalette',
  'DocumentOverview',
  'SchemaPage',
  'OperationHeader',
  'RuntimePanel',
  'ProvenanceTag',
  'DriftCard',
  'ParamTable',
  'ResponseList',
  'CodeSample',
  'SchemaTree',
  'ShapeForm',
  'AuthPanel',
  'ServerSelect',
  'SendButton',
  'ResponseView',
  'StreamLog',
  'HealthScore',
  'StateNotice',
] as const satisfies readonly SlotName[];

/**
 * Compile time proof that {@link SLOT_NAMES} lists every key of {@link SlotPropsMap}.
 *
 * `satisfies` above catches a name that is not a slot. This catches a slot that is not named,
 * which is the direction that would otherwise ship a slot no theme can reach.
 */
export type SLOT_NAMES_ARE_COMPLETE = SlotName extends (typeof SLOT_NAMES)[number] ? true : never;

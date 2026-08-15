# `@openref/vue` public API

The headless layer an OPENREF theme is written against. It carries state and composables, and
no markup and no styles at all.

**This file is the surface, not a summary of it.** `test/integration/public-surface.spec.ts`
reads the built type declarations and fails when the package exports a name this document does
not list, and when this document lists a name the package does not export. The check is against
`dist/`, not against `src/`: a declaration and an artefact that disagree are a package that
documents one thing and ships another, and only the artefact reaches you.

Everything here is frozen from T031. Adding a name is a minor version, removing or retyping one
is a major version, and each of the three contracts below is pinned by a type level test that
fails to compile rather than failing at runtime:

| Contract | Pinned by |
| --- | --- |
| Slot props | `packages/vue/test/unit/slot-contract.spec.ts` |
| Theme definition | `packages/vue/test/unit/theme-contract.spec.ts` |
| Collector interface | `packages/nest/test/unit/collector-contract.spec.ts` |

## Two entry points, split by gesture

| Specifier | What is on it |
| --- | --- |
| `@openref/vue` | Everything a page needs before a reader touches anything |
| `@openref/vue/runner` | The try-it surface, which a page loads only when a reader opens a console |

The split is a measurement rather than a taxonomy. A barrel the first paint imports statically,
re-exporting a module statically, puts that module in the first paint whichever side uses the
name: with `useRunner` on the main barrel it cost every reader of every page 962 bytes for a
console most of them never open. A theme overriding `AuthPanel`, `SendButton`, `ResponseView`,
`ShapeForm` or `StreamLog` imports from `@openref/vue/runner` and pays the same way the shipped
console does.

## `@openref/vue`

### Package identity

| Name | Kind | What it is |
| --- | --- | --- |
| `PACKAGE_NAME` | value | This package's name, so a diagnostic can say which package produced a value |
| `UPSTREAM_PACKAGES` | value | The packages this one may depend on, which the dependency graph linter follows |

### Document state

| Name | Kind | What it is |
| --- | --- | --- |
| `createDocState` | value | Builds the reactive state a headless tree is rendered from |
| `DocState` | type | That state: the document, the selection, the query, the theme |
| `DocStateOptions` | type | What `createDocState` takes |
| `DOC_STATE_KEY` | value | The injection key the state is provided under |
| `provideDocState` | value | Provides the state, and the slot registry with it, to everything below |
| `useDocState` | value | The state provided above, refusing when there is none |

### Nodes and operations

| Name | Kind | What it is |
| --- | --- | --- |
| `materializeNode` | value | Resolves one node of the IR into the view a page draws from |
| `NodeView` | type | That view, discriminated by `kind` |
| `OperationView` | type | The HTTP arm of it |
| `ChannelView` | type | The event arm of it |
| `orderedParameters` | value | An operation's parameters in the order SPEC 5 fixes |
| `PARAMETER_LOCATIONS` | value | The four locations, in that order |
| `ResolvedSecurityRequirement` | type | One security requirement with its scheme resolved |
| `resolveSchemaSlot` | value | The schema behind a request or response slot |

### Schema tree

| Name | Kind | What it is |
| --- | --- | --- |
| `schemaTreeRoot` | value | The root row of a named schema |
| `inlineSchemaTreeRoot` | value | The root row of a schema written inline |
| `expandSchemaNode` | value | The children of one row, resolved lazily |
| `schemaDisplayName` | value | What a schema is called in a row |
| `SchemaTreeNode` | type | One row of the tree |
| `SchemaTreeRelation` | type | How a row relates to its parent, which is how row kinds are told apart |
| `SchemaExpansionOptions` | type | What `expandSchemaNode` takes |

### Search

| Name | Kind | What it is |
| --- | --- | --- |
| `ISearchPort` | type | How a search index reaches this layer |
| `SearchHit` | type | One hit |
| `SearchHitKind` | type | What a hit points at |

### The runner port

| Name | Kind | What it is |
| --- | --- | --- |
| `IRunnerPort` | type | How a request runner reaches this layer, with the OAuth2 and streaming halves optional |
| `RUNNER_KEY` | value | The injection key a runner is provided under |
| `provideRunner` | value | Provides a runner to everything below |
| `useRunnerPort` | value | The runner provided above, or nothing |
| `runnerOperationOf` | value | Projects an IR operation into what sending it requires |
| `RunnerOperationView` | type | That projection |
| `RunnerParameterView` | type | One parameter, reduced to what sending it requires |
| `RunnerValue` | type | One value a reader supplied, in one of the three kinds of SPEC 14.2 |
| `RunnerValueKind` | type | Which of those three a parameter's schema declares |
| `RunnerBody` | type | What a reader supplied for the body |
| `RunnerBodyField` | type | One named field of a form body, as filled in |
| `RunnerBodyEditor` | type | Which of the three controls a media type is filled in with |
| `RunnerBodyFieldView` | type | One field of a form body, as drawn |
| `RunnerBodyMediaTypeView` | type | One declared media type and how it is filled in. Carries optional `exampleText` since `TX-PARITY-UI`, the bench's prefill |
| `RunnerFile` | type | A file the reader chose, as bytes |
| `RunnerSendInput` | type | One send: operation, server, values, body |
| `RunnerResult` | type | What came back, and how long it took |
| `RunnerResultHeader` | type | One response header |
| `RunnerNotice` | type | Something about the session the response alone does not say |
| `RunnerSecuritySchemeView` | type | One security scheme, reduced to what signing in requires |
| `RunnerOAuthFlowKind` | type | The five OAuth2 flows, keyed as OpenAPI keys them |
| `RunnerOAuthFlowView` | type | One flow, reduced to the urls and scopes running it requires |
| `RunnerOAuthClient` | type | What a reader supplied about an OAuth2 client |
| `RunnerDeviceAuthorization` | type | What a device flow told the reader to do |
| `RunnerSignInOutcome` | type | Signed in, redirect, or a device to approve |
| `RunnerSessionStatus` | type | What one scheme's session looks like to whatever draws it |
| `RunnerStreamView` | type | What it takes to watch a streaming operation |
| `StreamItemSchemaView` | type | The subset of a schema the bounded item check of SPEC 14.6 reads |
| `RunnerStreamElement` | type | One element of a running stream |
| `RunnerStreamEnd` | type | How a stream ended, and what it delivered |
| `RunnerStreamEndReason` | type | Which of the six endings it was |
| `RunnerStreamHandlers` | type | Where a running stream reports to |
| `RunnerStreamHandle` | type | A stream that is running, and the one thing that can be done to it |

### The page model

What the server draws a page from and the browser hydrates from. A slot's props are declared in
terms of these, and never in terms of the IR, because the IR does not travel: `AppShell.document`
would have been 1 612 858 bytes on `twilio-api-v2010.yaml` against a node page's 23 153.

| Name | Kind | What it is |
| --- | --- | --- |
| `PageModel` | type | One page, as it travels. Carries `kind` and `frame` since `TX-FRAME` |
| `PageKind` | type | Which page it is. Seven members since `TX-FRAME`: the three, then `bench`, `health`, `shapes`, `states`, per SPEC 13.3 |
| `FrameModel` | type | The app bar's data: resolved tabs, breadcrumb, back, rail statistics. Added at `TX-FRAME`, minor |
| `FrameTabModel` | type | One tab with its target resolved, so no theme spells an address twice |
| `FrameTabKind` | type | Which tab it is. Six since `TX-PARITY-UI`: the showcase pages entered the bar by the maintainer's reversal, and the bar is constant by remembering, per SPEC 11 |
| `FrameStatsModel` | type | The rail's stats row; `drift` is null on a document nothing measured, which is not zero |
| `NodeModel` | type | A node page. Carries `drawn` since `TX-ADOPT`: the sections the server drew, in draw order, which is what both sides of hydration walk |
| `NodeSectionMark` | type | One entry of `drawn`. No `errors` member: the contracts grid is inside the responses section since `TX-ADOPT` |
| `NodeHeaderModel` | type | Its header. Promises `tags` and `operationId` since `TX-MARKUP`, for the kicker, and `sse` since `TX-PARITY-UI`, for the badge |
| `SchemaPageModel` | type | A named schema on its own page. Carries `dialect` since `TX-MARKUP` |
| `NavEntryModel` | type | One row of the navigation. Carries `driftCount` since `TX-FRAME`, summed over children for a group; zero draws no marker and asserts nothing. Carries `method` since `TX-MARKUP`, for the rail's badge, and `sse` since `TX-PARITY-UI`, for the badge that says SSE |
| `PaletteHitModel` | type | One row of the command palette |
| `ParameterModel` | type | One parameter row, with its description already HTML. Carries the scan's columns since `TX-PARITY-UI`: `runtimeNote`, `confidence`, `collector`, `unread` |
| `ResponseModel` | type | One response, compact since `TX-PARITY-UI`: `phrase`, `schemaLabel` and `schemaHref` added, `content` kept with its `exampleHtml` built empty, the schemas on their own pages |
| `MediaTypeModel` | type | One media type of a request or response. Carries `hasExample` since `TX-ADOPT`: the example is markup the browser adopts, so the flag survives redaction and the bytes do not |
| `CodeSampleModel` | type | One call sample, per SPEC 18 |
| `SecurityModel` | type | The security a node declares |
| `RuntimeModel` | type | The runtime block of a node page. Carries `responseMarks` and `contracts` since `TX-MARKUP`, empty when no error collector ran |
| `RuntimeRowModel` | type | One row of it |
| `RuntimeRowKind` | type | What kind of row it is, which is how a theme tells an error row from a scope row |
| `RuntimeValueModel` | type | One runtime value, carrying its `confidence` and its `collector` |
| `ParityRowModel` | type | One row of the parity scale: spec side, runtime side, verdict |
| `ParityRowKind` | type | Which of the design's eleven subjects a parity row compares |
| `ParityVerdict` | type | The gutter's answer: match, drift, or a comparison that did not run |
| `ParitySideModel` | type | The specification side of a parity row, which carries no provenance |
| `ParityFixModel` | type | The remedy strip under a drifted row, with the SPEC 7.1 display code |
| `ResponseMarkModel` | type | What the runtime knows about one response code, joined to the responses block. Added at `TX-MARKUP`, minor |
| `ErrorContractGroupModel` | type | One group of the error contracts grid, per SPEC 6.4. Added at `TX-MARKUP`, minor |
| `ErrorContractItemModel` | type | One item of it: one contract, or several merged because they say the same thing |
| `DriftModel` | type | One drift finding |
| `HealthModel` | type | The Documentation Health report of a document. Carries `kpi` since `TX-PARITY-UI` |
| `HealthCheckModel` | type | One check of it |
| `HealthKpiModel` | type | The head's triple: operations, critical, warnings. Added at `TX-PARITY-UI`, minor |
| `HealthRuleModel` | type | One rule, with its findings grouped under it. Carries `code`, `summary` and `severityClass` since `TX-PARITY-UI`, and a silent rule is a row with no findings |

### Slots

| Name | Kind | What it is |
| --- | --- | --- |
| `SLOT_NAMES` | value | The 21 slots, in registry order |
| `SlotName` | type | One of them |
| `SlotProps` | type | The props of one named slot |
| `SlotPropsMap` | type | Every slot's props, which is the frozen contract |
| `SLOT_NAMES_ARE_COMPLETE` | type | The compile time proof that the list and the map name the same slots |
| `SERVER_RESOLVED_SLOTS` | value | The eight positions whose override resolves on the server only, per SPEC 10.4 and `TX-ADOPT`; the browser adopts their markup and never hydrates them |
| `ServerResolvedSlot` | type | One of them |
| `SERVER_RESOLVED_ROOTS` | value | The root element each stubbed server resolved position must keep, shared by the renderer's stubs and `@openref/theme-kit`'s refusal |
| `SchemaPayloadMap` | type | The schemas a page carries, keyed by id, as `SchemaTree` is handed them |
| `StateNoticeKind` | type | Which sentence a `StateNotice` is drawing. Nine since `TX-FRAME`: `health-missing` is the health page nothing measured |
| `StreamCounts` | type | What a `StreamLog` is handed beside its elements |
| `createSlotRegistry` | value | Builds a registry from a theme's components |
| `SlotRegistry` | type | That registry |
| `SLOT_REGISTRY_KEY` | value | The injection key it is provided under |
| `provideSlots` | value | Provides a registry to everything below |
| `useSlotRegistry` | value | The registry provided above, or nothing, which is the L0 case |
| `useSlot` | value | The component in one position: the theme's, or the one the renderer ships |

### Theme

| Name | Kind | What it is |
| --- | --- | --- |
| `defineTheme` | value | Declares a theme, which is data and runs nothing at import time |
| `ThemeDefinition` | type | A theme as its author writes it |
| `ThemeTokens` | type | Token defaults, as CSS custom properties |
| `ThemeAssets` | type | Stylesheets a theme brings with it |
| `resolveTheme` | value | Validates a theme and resolves it into the form the state holds |
| `ResolvedTheme` | type | That form |
| `resolveSlots` | value | The registry half of it, with `layout` resolved into `AppShell` and no validation |
| `DEFAULT_THEME_NAME` | value | The name in force when nobody supplied a theme |
| `useTheme` | value | The theme in force, its tokens, its assets and what it overrides |
| `UseTheme` | type | What that returns |

### Composables

| Name | Kind | What it is |
| --- | --- | --- |
| `useDocument` | value | The document, its nodes and its navigation |
| `UseDocument` | type | What that returns |
| `useNode` | value | One node, or the current selection |
| `UseNode` | type | What that returns |
| `useOperation` | value | One HTTP operation and its parts |
| `UseOperation` | type | What that returns |
| `useChannel` | value | One event channel and its parts |
| `UseChannel` | type | What that returns |
| `useRuntime` | value | What the application knows about a node, with provenance on every fact |
| `UseRuntime` | type | What that returns |
| `useHealth` | value | The Documentation Health report and its findings |
| `UseHealth` | type | What that returns |
| `useSchemaView` | value | One schema as a tree, expanded a level at a time |
| `UseSchemaView` | type | What that returns |
| `useSearch` | value | Search over the document, reporting itself unavailable when no index was supplied, which is every page the shipped reference serves until M3 |
| `UseSearch` | type | What that returns |
| `DEFAULT_HIT_LIMIT` | value | Hits returned when nothing narrows the request further |
| `useSocket` | value | The interactive event client of SPEC 16, which arrives in M6 |
| `UseSocket` | type | What that returns |

## `@openref/vue/runner`

| Name | Kind | What it is |
| --- | --- | --- |
| `useRunner` | value | The runner for a node id, resolved out of the document state |
| `useRunnerFor` | value | The same engine over a projection alone, which is what a rendered page has |
| `UseRunner` | type | What both return: sending, credentials, and the sign in surface of SPEC 14.4 |
| `UseRunnerSendArgs` | type | What a send needs beyond the operation |
| `UseRunnerSignInArgs` | type | What a sign in needs beyond the scheme |

## What is stubbed, and until when

A composable that is declared and not implemented is named here with the milestone that fills
it, because a name in a frozen surface with no milestone is a name nothing will ever fill.

| Name | State | Filled by |
| --- | --- | --- |
| `useSocket` | Declared. `available` is false and `connect` rejects with a sentence naming the milestone | M6, `T055`, the WebSocket client |
| `useChannel` | Implemented, and finds nothing until a document carries channels | M5, `T048`, the AsyncAPI normalizer |
| `useSearch` | Implemented, and `available` is false on every page the shipped reference serves, because no shipped path supplies the index the server already holds | M3, `T039`, which wires the served index into the palette |

Every other composable on this page is implemented against the document and the state a page
already carries. `useChannel` is listed because the distinction matters to whoever reads its
empty result: it is a working composable over a document with no channels in it, and not a stub.
`useSearch` is a third state and not either of those: the function works the moment a host
supplies the port, and the page this repository ships never does, so what is true of the
function is false of the page. Counting it implemented with no milestone is how that gap
stayed unwritten.

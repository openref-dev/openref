# @openref/vue

The headless layer an OPENREF theme is written against. It carries state, composables, the page model
a rendered page travels as, and the registry of positions a theme fills. It carries no markup and no
styles at all, which is what makes a theme possible without reworking the renderer: everything a
theme needs is reachable through a composable or arrives as a prop, so a theme never reaches into a
store.

This is the whole surface a theme author needs. `@openref/theme-telltale` is written against it and
nothing else of this project, which is what the second theme exists to prove.

## Install

```sh
npm install @openref/vue
```

Vue 3 arrives with it as a dependency rather than a peer. There is nothing else to install: the IR
types the slot props are declared in are re-exported here, so typing the value a component is handed
does not cost a second package.

## Use

```ts
import { defineTheme } from '@openref/vue';
import ProvenanceTag from './components/ProvenanceTag';

export default defineTheme({
  name: 'aurora',
  layout: () => import('./Layout'),
  components: { ProvenanceTag },
  assets: { css: ['@openref/theme-aurora/theme.css'] },
});
```

A theme is data and runs nothing at import time. Each component is handed the props its position
declares, and reads anything else through the composables:

```ts
import { h, type VNode } from 'vue';
import type { IRConfidence } from '@openref/vue';

export default function ProvenanceTag(props: {
  readonly confidence: IRConfidence;
  readonly collector: string;
}): VNode {
  const attrs = { class: `oref-prov-${props.confidence}`, title: props.collector };

  return h('abbr', attrs, props.confidence);
}
```

`defineTheme` is an identity function with a type on it. `ThemeDefinition` is five members, one of
them required: `name`, and then `layout`, `components`, `tokens` and `assets`. `layout` and
`components.AppShell` are one position under two names, and a theme writing both is refused.

## The composables

Every one of them reads the provided document state and throws a `ThemeContractError` when nothing
provided it, which is a wiring mistake rather than a deployment choice.

| Composable                | Returns                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `useDocument()`           | The document, its info, hash, kind, navigation, servers, security, node ids, the active id and `select` |
| `useNode(id?)`            | One node materialized lazily, and whether it exists; no id follows the selection                        |
| `useOperation(id?)`       | Parameters, request body, responses, security and `deprecated`; `undefined` for a channel               |
| `useChannel(id?)`         | Operations and messages; `undefined` for an HTTP operation                                              |
| `useRuntime(id?)`         | Guards, scopes, roles, rate limit, streaming, errors, source and drift, with provenance intact          |
| `useHealth()`             | The Documentation Health report, its score and mark, suppression, checks and counts                     |
| `useSchemaView()`         | The schema viewer state: the view, the expanded paths and the expand, collapse and toggle actions       |
| `useSearch(limit?)`       | The query, the hits and `available`; `limit` defaults to `DEFAULT_HIT_LIMIT`, 20                        |
| `useSocket(id?)`          | The event client: status, log, message, and `connect`, `send`, `close`                                  |
| `useTheme()`              | The resolved theme: name, tokens as a map, assets, `slot(name)` and `overridden`                        |
| `useSlot(name, fallback)` | The theme's component for a position, or the fallback; reads the slot registry rather than the state    |

```ts
import { useHealth, useOperation, useRuntime } from '@openref/vue';

const { operation, parameters } = useOperation();
const { guards, scopes, drift } = useRuntime();
const { score, scoreMark } = useHealth();
```

`useHealth().available` distinguishes "nothing was measured" from a score of zero, and
`useSearch().available` is false when no search port was supplied. `useTheme().tokens` is a map and
never a style string, because a nonce cannot authorize an inline `style` attribute.

## How a theme reaches state

There is no store and no module level singleton. Two references mounted on one page, which federation
makes ordinary, would share a singleton and would not share a provided value, so it is Vue
`provide`/`inject` with `Symbol` keys throughout.

`createDocState({ document, theme?, search?, activeNodeId?, view? })` builds the state and
`provideDocState(state)` puts it in scope; that call also provides the slot registry. Three more keys
exist for the things a page may or may not have: `RUNNER_KEY` with `provideRunner` and
`useRunnerPort`, `SOCKET_KEY` with `provideSocket` and `useSocketPort`, and `SLOT_REGISTRY_KEY` with
`provideSlots` and `useSlotRegistry`. Those three answer `undefined` when nothing provided them,
because a missing runner is a deployment choice, while a missing document state is a mistake.

## The surface is frozen, and it is written down

`PUBLIC-API.md` in this package is the export surface rather than a summary of it:
`test/integration/public-surface.spec.ts` reads the built type declarations and fails both ways, when
this package exports a name that file does not list and when that file lists a name the package does
not export. It checks `dist/`, not `src/`, because only the artefact reaches you.

Three contracts are pinned by type level tests that fail to compile rather than at runtime: the slot
props, the theme definition, and, over in `@openref/nest`, the collector interface. Adding a name is a
minor version; removing or retyping one is a major version, and widening an exported union counts as
retyping it, because a total `Record` over that union is a sanctioned way to write a theme.

## The slot registry

`SLOT_NAMES` is the registry, 21 positions in this order:

```
AppShell        NavTree       CommandPalette  DocumentOverview  SchemaPage
OperationHeader RuntimePanel  ProvenanceTag   DriftCard         ParamTable
ResponseList    CodeSample    SchemaTree      ShapeForm         AuthPanel
ServerSelect    SendButton    ResponseView    StreamLog         HealthScore
StateNotice
```

`SlotPropsMap` declares what each one is handed, `SlotName` is its `keyof`, and
`SlotProps<'ParamTable'>` is one position's props. All three live in
`src/slots/domain/slot-props.types.ts`, and all three are frozen public API.

`SERVER_RESOLVED_SLOTS` is the subset whose override resolves on the server only:
`DocumentOverview`, `OperationHeader`, `RuntimePanel`, `ProvenanceTag`, `DriftCard`, `ParamTable`,
`ResponseList` and `HealthScore`. The browser adopts that markup without hydrating it, so a handler
attached in one of those positions is never attached at all, and a root element other than the one
`SERVER_RESOLVED_ROOTS` names loses its markup on hydration. `@openref/theme-kit` finds both before a
reader does.

## Two entry points, split by gesture

| Specifier             | What is on it                                                 |
| --------------------- | ------------------------------------------------------------- |
| `@openref/vue`        | Everything a page needs before a reader touches anything      |
| `@openref/vue/runner` | The try-it surface, loaded only when a reader opens a console |

The split is a measurement rather than a taxonomy. A barrel that the first paint imports statically
carries every module it re-exports, whichever side names the symbol, so `useRunner` on the main
barrel cost every reader of every page close to a kilobyte for a console most never open. A theme that
overrides `AuthPanel`, `SendButton`, `ResponseView`, `ShapeForm` or `StreamLog` imports from
`@openref/vue/runner` and pays the same way the shipped console does.

`useRunner(id?)`, `useRunnerFor(operation)` and `prettyResponseBody` are what is over there.
`useRunnerFor` is the one the renderer itself calls, because a rendered page carries the operation
projection rather than the IR. The port stays on the main barrel: `RUNNER_KEY`, `provideRunner` and
`useRunnerPort` are how a runner is handed to a page at all, so the first paint reaches for them by
construction, and they are 116 bytes.

## What a theme still has to style by hand

An L2 theme replaces every position and still receives markup drawn outside all of them, under the
reference's own `oref-` class names. Those names are not frozen and a theme that ignores them ships
unstyled regions with nothing going red on its own side. The list is pinned by a test in
`@openref/theme-telltale`, which fails when a name arrives or leaves, and `THEME-BOUNDARY.md` in that
package is the honest account of what the contract does not yet carry. Read it before writing a theme.

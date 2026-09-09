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

## The surface is frozen, and it is written down

`PUBLIC-API.md` in this package is the export surface rather than a summary of it:
`test/integration/public-surface.spec.ts` reads the built type declarations and fails both ways, when
this package exports a name that file does not list and when that file lists a name the package does
not export. It checks `dist/`, not `src/`, because only the artefact reaches you.

Three contracts are pinned by type level tests that fail to compile rather than at runtime: the slot
props, the theme definition, and, over in `@openref/nest`, the collector interface. Adding a name is a
minor version; removing or retyping one is a major version, and widening an exported union counts as
retyping it, because a total `Record` over that union is a sanctioned way to write a theme.

`SLOT_NAMES` is the registry, 21 positions in order. `SERVER_RESOLVED_SLOTS` is the subset whose
override resolves on the server only: the browser adopts that markup without hydrating it, so a
handler attached in one of those positions is never attached at all. `@openref/theme-kit` finds that
before a reader does.

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

## What a theme still has to style by hand

An L2 theme replaces every position and still receives markup drawn outside all of them, under the
reference's own `oref-` class names. Those names are not frozen and a theme that ignores them ships
unstyled regions with nothing going red on its own side. The list is pinned by a test in
`@openref/theme-telltale`, which fails when a name arrives or leaves, and `THEME-BOUNDARY.md` in that
package is the honest account of what the contract does not yet carry. Read it before writing a theme.

# @openref/theme-kit

What a theme author runs. Three things, each answering a question the other two do not: the
conformance checker reads a theme as data and refuses it by name, the harness runs its components
against a real document and reports which threw, and the scaffold writes a theme package that passes
the first and survives the second.

The contract itself lives in `@openref/vue`. This package is how you find out that you satisfied it,
outside this repository and in your own test suite.

## Install

```sh
npm install -D @openref/theme-kit @openref/vue
```

No peer dependencies. Vue 3 arrives with it, because the harness renders your components.
`@openref/vue` is in the line because that is what the theme itself is written against.

## Use

```ts
import { assertTheme, checkTheme } from '@openref/theme-kit';
import aurora from '../src/theme';

// In a test: throws a ThemeContractError naming every problem.
assertTheme(aurora, { level: 'L2' });

// Or read the report instead of throwing.
const report = checkTheme(aurora, { level: 'L2' });
report.missingSlots; // ['StreamLog']
```

`ThemeContractError`, `ThemeError`, `OpenRefError` and `ErrorCode` are re-exported here, so a
`toThrow(ThemeContractError)` assertion needs no second dependency. They are `@openref/core`'s own
classes rather than copies, so `instanceof` answers true.

`{ level }` is the whole options type and it has no default: `'L1'` or `'L2'`, named at every call.
The report is five members: `name`, `level`, `conforms`, `missingSlots`, `unknownSlots`, and the
`problems` list each of the last two is derived from. A problem carries its `kind`, its `subject` and
the sentence a reader acts on, and `kind` is one of `missing-slot`, `unknown-slot`, `duplicate-shell`,
`invalid-name` and `bad-token`.

## What the checker verifies

- Every name the theme filled is one of the 21 slots of the frozen registry. A name that is not is
  refused, because nothing will ever render it.
- At `L2`, every one of the 21 is filled, the page shell included, since the reference ships no
  markup for an L2 theme to fall through to. At `L1` only the first rule applies, because falling
  through is what an L1 theme is for. That is the only rule the level changes; the other four apply
  at both.
- `layout` and `components.AppShell` are one position under two names, so a theme that writes both is
  refused here rather than at load time, and one that writes `layout` alone is not told it is missing
  a slot it has written.
- The theme name is lowercase words joined by hyphens, matching `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`,
  since it becomes a package name and a class name fragment.
- Every token key is a custom property in the `--oref-` namespace, matching
  `^--oref-[a-z0-9]+(-[a-z0-9]+)*$`, because nothing in the reference reads one that is not.

Each refusal names its subject and says what to write next, rather than handing back a diff for the
author to interpret. `assets` is not checked. `assertTheme` throws with every problem on its own
line, code `THEME_CONTRACT_VIOLATED`, and the two lists in the error's context.

## What the checker does not do

It never renders, so a theme that fills every position with a component that throws on mount passes
it: conflating the two questions would report a rendering bug as a contract violation. The harness is
where the components run:

```ts
import { renderThemeSlots } from '@openref/theme-kit';

const report = await renderThemeSlots(aurora.components ?? {}, state, {
  StateNotice: { kind: 'search-no-results', message: 'Nothing matched that query' },
});

report.rendered; // the components that rendered, with their html
report.failed; // the components that threw, with the message each threw with
report.refused; // overrides that would be dead in the adopted page
```

All three arguments are required: the components map, a `DocState` from
`@openref/vue`'s `createDocState`, and the props to hand each slot, keyed by slot name. Props come
from the caller and are never invented, so the harness holds no private opinion about the contract
beside the one in `SlotPropsMap`.

It renders on the server, one slot at a time, in its own app, and a throw is a result rather than a
stop: an author wants the list of which components are broken, not the first one. A server render
rather than a DOM, because a theme is markup and composables, it touches no DOM, and mounting one
would add a dependency and hide a violation. The components go through the same
`createSlotRegistry` a running reference uses, so a name that is not a slot is refused by the same
code.

`report.refused` is the probe. A server resolved position never hydrates, so an override that
attaches a handler there has attached nothing, and one that changes its root element loses its markup
the moment the page hydrates. `probeAdoptedSlot(slot, component, props)` finds both before the first
reader does, by mounting the override once through a Vue renderer whose every node operation is a
stub, and it reports `client-state` for a prop that looks like a listener and `wrong-root` for a root
element other than the one that position expects. `isServerResolved(name)` is the narrowing that says
which slots it applies to; only a slot that rendered is probed, since a throwing override is already
in `failed` with its own message.

## Starting from something that conforms

```ts
import { scaffoldTheme } from '@openref/theme-kit';

scaffoldTheme({ name: 'aurora', level: 'L2' }); // every file of the package, as data
```

Both options are required and neither has a default. It returns `{ path, contents }` for every file
and writes nothing, so the caller decides where they land, and what comes back passes the checker on
its first run rather than starting from an empty directory. A generator that wrote to disk could only
be tested by writing to disk, and what has to be tested is the content.

Four files always: `package.json`, naming the package `@openref/theme-aurora` and declaring
`@openref/vue` and `vue` as peers; `src/theme.ts`; `src/aurora.css`; and `README.md`. An `L1` theme
adds `src/components/StateNotice.ts`, five files in all. An `L2` theme adds `src/Layout.ts` and one
component per slot except `AppShell`, twenty of them, twenty-four files in all.

There is never a `src/components/AppShell.ts`. The shell is `src/Layout.ts`, reached through
`layout: () => import('./Layout')`, which is the authoring surface; writing both would generate a
theme the loader refuses, which is the thing the scaffold exists not to do. The components are `.ts`
rather than `.vue`, because a single file component needs a compiler before even the conformance
check can run. Every L2 stub is visible and prints its own slot name, so the first harness run is a
page that labels every region.

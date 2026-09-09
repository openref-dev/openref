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

## What the checker verifies

- Every name the theme filled is one of the 21 slots of the frozen registry. A name that is not is
  refused, because nothing will ever render it.
- At `L2`, every one of the 21 is filled, the page shell included, since the reference ships no
  markup for an L2 theme to fall through to. At `L1` only the first rule applies, because falling
  through is what an L1 theme is for.
- `layout` and `components.AppShell` are one position under two names, so a theme that writes both is
  refused here rather than at load time, and one that writes `layout` alone is not told it is missing
  a slot it has written.
- The theme name is lowercase words joined by hyphens, since it becomes a package name and a class
  name fragment, and every token key is a custom property in the `--oref-` namespace, because nothing
  in the reference reads one that is not.

Each refusal names its subject and says what to write next, rather than handing back a diff for the
author to interpret.

## What the checker does not do

It never renders, so a theme that fills every position with a component that throws on mount passes
it: conflating the two questions would report a rendering bug as a contract violation. The harness is
where the components run:

```ts
import { renderThemeSlots } from '@openref/theme-kit';

const report = await renderThemeSlots(aurora.components ?? {}, state, {
  StateNotice: { kind: 'search-no-results', message: 'Nothing matched that query' },
});

report.failed; // the components that threw, with the message each threw with
report.refused; // overrides that would be dead in the adopted page
```

It renders on the server, one slot at a time, in its own app, and a throw is a result rather than a
stop: an author wants the list of which components are broken, not the first one. Props come from the
caller and are never invented, so the harness holds no private opinion about the contract beside the
one in `SlotPropsMap`.

`report.refused` is the probe. A server resolved position never hydrates, so an override that
attaches a handler there has attached nothing, and one that changes its root element loses its markup
the moment the page hydrates. `probeAdoptedSlot` finds both before the first reader does.

## Starting from something that conforms

```ts
import { scaffoldTheme } from '@openref/theme-kit';

scaffoldTheme({ name: 'aurora', level: 'L2' }); // every file of the package, as data
```

It returns the files and writes nothing, so the caller decides where they land, and what comes back
passes the checker on its first run rather than starting from an empty directory.

# What the second theme found

T032 exists to prove the theme contract is real. `@openref/theme` was written in the same sessions
as the renderer it draws through, so a position the renderer could not fill would have been fixed
on both sides without anybody noticing there had been a boundary. This package was written against
the published `@openref/vue` alone, by a task whose definition of done is an empty diff to every
other package, which is what makes what follows evidence rather than opinion.

**The contract holds where it was tested and does not hold where it was not.** All 21 positions of
the frozen registry are this theme's own, every one of them is driven through `renderPage` by
`test/integration/slot-coverage.spec.ts`, and every one of them draws. That is the result the task
was scheduled for and it is a real one.

Five things came back the other way. None of them is worked around here. Each is pinned by a case
in `test/integration/theme-boundary.spec.ts`, so the task that changes the boundary sees it go red.

## 1. Twenty five class names the theme did not write, and cannot replace

Measured, on the four pages a reader can open, with all 21 positions overridden:

```
oref-code            oref-node-columns    oref-section-title
oref-column-runtime  oref-operation       oref-section-tryit
oref-column-spec     oref-root            oref-security-item
oref-description     oref-section         oref-security-list
oref-example         oref-section-health  oref-security-type
oref-field           oref-section-request oref-tryit-form
oref-field-control   oref-section-security
oref-field-label     oref-media
oref-field-note      oref-media-head
                     oref-media-type
```

SPEC 10.1 says an L2 theme is "a package with its own layout; the core contributes no styles". The
core contributes no *stylesheet*. It contributes *markup*, under its own class names, and a theme
that does not style them ships a page with unstyled regions on every operation. So the last block
of `src/styles/theme.css` styles class names from somebody else's namespace, which is the opposite
of what a frozen contract is for.

Two of them are content rather than frame, and that is the sharp end: **the security requirements
of an operation and its whole request body block are drawn entirely by the reference.** Not the
frame around a position. The content. `NodePanel` composes six slots and writes those two itself.

The pattern for new markup, recorded 2026-08-14 after two sessions measured both sides of it:
**new markup goes inside an existing position unless there is a reason it cannot, because markup
outside every position is markup no theme can replace.** TX-MARKUP put the merged response list
and the error contract grid inside `ResponseList`, chosen for that reason before the code was
written, and this list grew by zero names. TX-FRAME drew two page articles outside every position
and the list grew by four. The position is not where the markup happens to land; it is the first
question the task answers.

TX-PARITY-UI, the same day, measured both sides again: the compact response row, the parameter
columns, the health KPI, the rule rows and the tree marks all landed inside positions and cost
zero names; the bench head, its actions row with Reset and the chord hint, and the description
section are page furniture drawn by `ReferenceApp`, `TryItPanel` and `NodePanel` outside every
position, and the list grew by eleven, the badge's generated `oref-method-*` family among them.
Whether the bench head becomes a position belongs to the telltale adoption task, with the two
page heads TX-FRAME already put there.

## 2. This theme cannot express its own thesis

`ai-docs/design/telltale/components.md` opens with what this direction does that the other two do
not: **the runtime block precedes the specification rather than following it.** That order is
decided inside `NodePanel`, which is not a slot, and `AppShell` is handed the page as opaque
children through the default slot. No position of the contract can reorder them.

`SlotPropsMap.AppShell` says block order "is the shell's business in the same way the two columns
are". As built it is nobody's business except `NodePanel`'s. This theme reverses the two columns
with `flex-direction: column-reverse`, which changes what a sighted reader sees and leaves the
reading order a screen reader follows exactly as the reference wrote it. That is a worse outcome
than not doing it, and it is done here only because the alternative is a layout that contradicts
its own design notes.

## 3. The route table is transcribed, not imported

`CommandPalette` is handed hits carrying a finished `href`. `NavTree` is handed `nodeId`,
`schemaId` and `basePath`, and has to build the link itself, which means knowing the reference's
route table: it lives in `packages/render/src/page/domain/links.ts` and is not published.

`src/links.ts` is that transcription. A theme that got one rule wrong would ship a reference whose
every navigation link is a 404, and nothing in the contract, the conformance checker or this
theme's own rendering tests would say so, because a wrong href is a string and a string renders.
The only thing that makes it fail is the case in `theme-boundary.spec.ts` that compares all three
rules with the reference's own, and that case can only exist inside this repository.

## 4. A theme author installs two packages, and is told about one

Three props of the registry are declared in IR types: `IRConfidence` on `ProvenanceTag`,
`IRSchema` on `ResponseList`, `IRSchemaView` on `SchemaTree`. `@openref/vue` re-exports none of
them, and `PUBLIC-API.md` lists 127 names without them. A theme that types the value it is handed
depends on `@openref/core` as well.

## 5. One position requires a class from the reference's namespace

`HealthScore` is the one server side slot. The browser fills that position with
`h('section', { class: 'oref-section-health' })` and nothing else, so hydration compares the class
list against exactly that one name. An override whose root also carried `tt-health` would have it
patched away on hydration, silently, in a browser and nowhere else. This theme's root is therefore
`section.oref-section-health` with its own class on the element inside.

## Smaller, recorded rather than filed

- The WCAG contrast arithmetic lives in `@openref/theme` and a theme may not depend on it, so
  every theme carries its own copy. `test/unit/contrast.spec.ts` is this one's.
- `SchemaPayloadMap` arrives as a `Record` and `SchemaExpansionOptions.schemas` wants a `Map`, so
  every theme drawing a body converts between them. `src/components/media.ts` does it once.
- `@openref/theme-kit` is what a theme author runs and is not published. This package needs it in
  `devDependencies` to check itself, which is the first time anything has needed it without the
  rest, and that is the condition SPEC 4 names for publishing a package. Filed against `T064`.

## What this theme corrected in its own handoff

- `--oref-color-drift-note-fg` measured 4.32:1 on its own background in light mode, under the 4.5
  a body of text has to reach. It was the one pair the handoff's contrast table did not cover.
  Raised to the value `--oref-color-fg-muted` already carries, which measures 4.70:1.
- The handoff wrote its dark values under `[data-oref-color-scheme='dark']` alone. Shipping that
  would ignore a reader who has already told their operating system what they want, so the shipped
  stylesheet answers `prefers-color-scheme` as well, and the attribute comes last so an explicit
  choice still wins.

## What the design asked for that the registry no longer has

The inventory in `ai-docs/design/telltale/components.md` was written against the 25 name registry.
Six of those names were removed by `TX-SLOTWIRE` and each removal has its reason in SPEC 10.4. Where
this theme wanted one, it used what replaced it rather than asking for the name back:

| Design named | What this theme did instead |
| --- | --- |
| `ErrorContract` | `RuntimePanel` tells an error row from a scope row by `RuntimeRowModel.kind` |
| `BranchPicker`, `PatternKeys`, `TupleField` | `SchemaTree` prints `SchemaTreeNode.relation` as a three letter code |
| `RuleFilter` | `HealthScore` filters with `details` and `summary`, which the browser opens |
| `ThemeToggle` | no control, and the reason is a product decision with a cost, in SPEC 10.4 |

`StatusBar`, `SectionIndex` and `BudgetMeter` were the three the design proposed as new slots. They
are this theme's own components, prefixed, exactly as `ai-docs/design/CONTRACT.md` resolved.
`TelltaleSectionIndex` is the one that argues for itself: an index of the sections on the page has
to read the DOM after mount to learn what is on the page, because the shell is handed the content
as children it cannot look inside. That is finding 2 again, from the other side.

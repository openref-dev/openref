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

Six things came back the other way. None of them is worked around here. Each is pinned by a case
in `test/integration/theme-boundary.spec.ts`, so the task that changes the boundary sees it go red.

**Re-measured by `T031-R1`, 2026-08-28.** Every number below had drifted, and the drift was one
way: the boundary is wider than when this file was written, not narrower. One of the six is closed,
finding 4. The other five stay open, each now naming who would close it and what closing it costs,
and two of them gained the check they were missing.

## 1. 86 class names the theme did not write, and cannot replace

Measured on the eight kinds of page a reader can open, the reader page family of SPEC 13.3, twelve
renders in all, with all 21 positions overridden. **The list is not repeated here.** It lives in
exactly one place, the pinned assertion in `test/integration/theme-boundary.spec.ts`, and a case in
the same file fails when this document, `packages/vue/PUBLIC-API.md` or SPEC 10.4 states a different
count, because a figure written in three places drifts in two, which is what happened: all three
said 25 while the list said 37.

Where the arrivals came from, each with the task that drew them:

| Task | Names | Why |
| --- | --- | --- |
| `T032` | 25 | The measurement this file was written for |
| `TX-GUTTER` | minus 3 | The page level columns left the reference; the parity markup lives inside `RuntimePanel`, which this theme overrides |
| `TX-FRAME` | plus 4 | Two new pages are articles the reference draws outside every position, and the bench head is its own two classes |
| `TX-PARITY-UI` | plus 11 | Page furniture: the bench head's kicker, badge and path, the actions row, the description section |
| pre-M5 cleanup | plus 11 | The service card of `T046`, an article outside every position, had shipped outside the sweep: its whole vocabulary was on no list and this theme styled none of it, so the page rendered on generic section styles and looked deliberate without being it |
| pre-`T049` slice | plus 18 | The shapes page, 14 names, and the states page, 4. Both are reader pages in SPEC 13.3 and both had been held out of the sweep by a comment calling them a theme author's addresses, so this theme styled neither. Same finding as the row above, twice over, which is why the sweep's page list is now a total record over `PageKind` instead of a hand written array |
| `T050` | plus 20 | The channel page. Seventeen are class names the tree did not have before this task, and three, `oref-media-schema`, `oref-schema-link` and `oref-subtitle`, are names the reference already drew and this theme had never met, because the positions that emit them are positions it overrides. **This is the third instance of the row above and the first the `PageKind` binding could not have caught**: a channel is a node, so a channel page is the `node` kind, and both `node` renders were OpenAPI documents. The sweep answers with two more renders of an AsyncAPI document rather than a wider record, because the record was never the thing that was short |
| `T052` | plus 0 | The topology of SPEC 9. The section is drawn inside `DocumentOverview`, a position this theme overrides, so not one of its seven class names survives to be a boundary name and the count does not move. **That is the finding rather than the absence of one**: the sweep can only ever report markup that outlives an override, so a whole feature added inside a position is invisible to it, and this theme would have served an overview with no graph on it while every list in this file stayed correct. The answer is a component change, not a stylesheet one: telltale's own `DocumentOverview` draws the graph in `tt-` names, and `topology-strip.spec.ts` is what fails when it stops. The overview render added to the sweep is kept anyway, so the day the reference stops overriding, the names arrive here instead of on a page

SPEC 10.1 says an L2 theme is "a package with its own layout; the core contributes no styles". The
core contributes no *stylesheet*. It contributes *markup*, under its own class names, and a theme
that does not style them ships a page with unstyled regions on every operation. So the last block
of `src/styles/theme.css` styles class names from somebody else's namespace, which is the opposite
of what a frozen contract is for. 85 of the 86 are styled here; the one that is not,
`oref-section-health`, is finding 5 below.

**What it costs a theme author, said plainly.** This list is not part of the frozen contract. A
minor version of `@openref/vue` can add a name to it, the theme that was written against the
previous minor keeps compiling and keeps rendering, and the only symptom is a region of a page
with no styling on it. Nothing on the theme's side can detect that; the case in this repository
can, and only because the theme and the reference are in one tree.

**Why it is not frozen, which is a decision and not an omission.** Freezing it makes every `oref-`
class public API, so removing one becomes a major version, and these names move whenever the markup
moves. That trade belongs to the release, not to a session: `T064`, release engineering, owns it
along with the published package list. Until then the rule that keeps the list from growing is the
one below.

Two of them are content rather than frame, and that is the sharp end: **the security requirements
of an operation and its whole request body block are drawn entirely by the reference.** Not the
frame around a position. The content. `NodePanel` resolves the positions of the page and writes
those two itself. Recorded in SPEC 10.4 by `T031-R1`, in the paragraph that lists the six removed
slot names and for the same reason: a name enters the registry when a real theme needs to draw
that region differently, and neither shipped theme has asked. The day one asks it is two names and
a minor version.

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

## 2. This theme cannot express block order, and its thesis got expressed for it

`ai-docs/design/telltale/components.md` opens with what this direction does that the other two do
not: **the runtime block precedes the specification rather than following it.** That order is
decided inside `NodePanel`, which is not a slot, and `AppShell` is handed the page as opaque
children through the default slot. No position of the contract can reorder them. That is still
true, and it is the half that stays open.

`SlotPropsMap.AppShell` said block order "is the shell's business in the same way the two columns
are". As built it is nobody's business except `NodePanel`'s, which walks `NodeModel.drawn`. That
comment was corrected by `T031-R1` on 2026-08-28, and SPEC 10.4 now records that a theme cannot
express block order and why: the fix is a position per block, which is a minor version, and it is
open under the chrome rule of SPEC 10.2 for the day a theme needs one.

**What this theme used to do about it, and no longer does.** It reversed the two page level columns
with `flex-direction: column-reverse`, which changed what a sighted reader saw and left the reading
order a screen reader follows exactly as the reference wrote it. `TX-GUTTER` removed the columns
and the parity scale put the runtime block directly after the header, so the document order is now
this theme's order and the workaround is gone. The thesis is expressed, and it is expressed by the
reference having changed its own mind, not by anything a theme can say.

## 3. The route table is transcribed, not imported

`CommandPalette` is handed hits carrying a finished `href`. `NavTree` is handed `nodeId`,
`schemaId` and `basePath`, and has to build the link itself, which means knowing the reference's
route table: it lives in `packages/render/src/page/domain/links.ts` and is not published.

`src/links.ts` is that transcription. A theme that got one rule wrong would ship a reference whose
every navigation link is a 404, and nothing in the contract, the conformance checker or this
theme's own rendering tests would say so, because a wrong href is a string and a string renders.
The only thing that makes it fail is the case in `theme-boundary.spec.ts` that compares the rules
with the reference's own, and that case can only exist inside this repository.

**And it failed to, which is the finding under the finding.** `T043` added two whole name rules to
the reference beside the character escape `T039` added: a reserved Windows device name is escaped
on its first character, and a trailing dot or space is escaped because Win32 strips it. This
transcription got neither, so from `T043` until `T031-R1` measured it on 2026-08-28 every link this
theme drew to a schema called `CON`, `NUL`, `com1` or `Order.` pointed at an address the server
does not serve. The case that exists to catch exactly this was green throughout, because it
compared one of the three rules. Both halves are fixed: the transcription carries all three rules,
and the case asserts each rule is firing in the reference before comparing, over a table that
includes every reserved device family and both stripped characters.

Publishing the builders instead of copying them is still the real fix, and it is not free: they
live in `@openref/render`, which depends on `@openref/vue`, so publishing means moving the module
across a package boundary and freezing the address space of SPEC 13.3 as public API. `T064` owns
that, with the published package list.

## 4. A theme author installs two packages, and is told about one. CLOSED

Four props of the registry are declared in types of `@openref/core`: `IRConfidence` on
`ProvenanceTag`, `IRSchema` on `ResponseList` and on the request body, `IRSchemaView` on
`SchemaTree`, and `UnsendableCause` on `RunnerSecuritySchemeView`. That is one more than this
document recorded on T032; the fourth arrived with the runner and was never counted.

Closed by `T031-R1` on 2026-08-28. `@openref/vue` re-exports all four as types, which is additive,
a minor version, and zero runtime bytes, and this package's `@openref/core` peer dependency came
off. No file under `src` names the core package. The case that pinned the defect is turned over
and now fails if a name leaves `PUBLIC-API.md`, if the peer dependency comes back, or if any file
under `src` imports from `@openref/core` again.

## 5. One position requires a class from the reference's namespace

`HealthScore` was the one server side slot when this was written; since `TX-ADOPT` there are eight,
listed in SPEC 10.4. It stays the sharp one. The browser fills that position with
`h('section', { class: 'oref-section-health' })` and nothing else, so hydration compares the class
list against exactly that one name. An override whose root also carried `tt-health` would have it
patched away on hydration, silently, in a browser and nowhere else. This theme's root is therefore
`section.oref-section-health` with its own class on the element inside. For the other seven the
reference's class on the root is a development build warning and nothing more, which is what this
theme pays.

## 6. The structural DOM shim is transcribed too, and was checked by nothing

T011 scopes DOM types to `src/browser` and the integration suite, so that a server only path cannot
reach `document` by accident and `tsc` fails over the main program when one tries. A theme's
components render on both sides, so they are inside that program and cannot name a DOM type.
`packages/render/src/shared/dom.ts` is what makes that possible for the reference, it is private,
and every theme writes it again. `src/dom.ts` is this one's.

Each file declares 11 shapes and they share 5: `ValueEvent`, `eventValue`, `PickedFile`,
`FileEvent`, `eventFile`. The other six here are what this theme's components touch and the
reference's do not, which is also the measurement that says publishing the reference's shim would
close less than half of this.

Filed by `T031-R1`, which found that `src/dom.ts` already pointed at this section and this section
did not exist: the transcription was recorded in a file nobody had written to. It now has a case in
`theme-boundary.spec.ts` that pins the shared five, compares both transcribed functions against the
reference's over the same events, and asserts mutual assignability of the three shared shapes at
compile time, so a drift fails `pnpm lint` before the suite runs. Publishing has the same owner as
finding 3, `T064`, and the same reason for waiting.

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

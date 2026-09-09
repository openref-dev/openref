# @openref/collector-casl

Reads the declarative CASL abilities a route carries under a metadata key your application names,
and reports them as the permissions the endpoint requires. CASL ships no decorator of its own, so
that key belongs to your project in every case: there is no default and no candidate list, and
passing the key is how you tell the collector where to look.

## Install

```sh
npm install @openref/collector-casl @openref/nest @casl/ability
```

`@openref/core` is a peer as well, for the types the facts are declared in. It arrives with
`@openref/nest`, so there is nothing extra to install for it. `@casl/ability` is an optional peer:
without it the factory declines rather than failing to load.

## Use

```ts
import { OpenRefModule } from '@openref/nest';
import { caslCollector } from '@openref/collector-casl';
import { ABILITIES_KEY } from './abilities.decorator';

OpenRefModule.forRoot({
  runtime: {
    collectors: [caslCollector({ metadataKey: ABILITIES_KEY })],
  },
});
```

| Option        | Type               | Default                  | Required |
| ------------- | ------------------ | ------------------------ | -------- |
| `metadataKey` | `string \| symbol` | none                     | yes      |
| `isInstalled` | `() => boolean`    | resolves `@casl/ability` | no       |

`metadataKey` is the key your own ability decorator writes under. It has to be the same value your
decorator passes to `SetMetadata` and the same value your guard passes to `Reflector`, because all
three are looking up one entry in one table: a key that differs by a character reads as a route that
declared nothing. Registering the collector without one is not an error, it is a skip that says so.

`isInstalled` is a test seam. A host passes nothing for it.

## Both sides of the key

The application writes the metadata:

```ts
// abilities.decorator.ts
import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

/** The key this application writes its abilities under. There is no default and none is guessed. */
export const ABILITIES_KEY = 'app.abilities';

export interface RequiredAbility {
  readonly action: string;
  readonly subject: string;
}

export function CheckAbilities(...abilities: RequiredAbility[]): CustomDecorator {
  return SetMetadata(ABILITIES_KEY, abilities);
}
```

The collector reads it, through Nest's own `Reflector.getAllAndOverride` over the handler and then
the controller, so the handler's declaration replaces the class's rather than adding to it. That is
the same lookup a guard of your own would make, which is what makes the reported list the one the
guard receives rather than an approximation of it.

## What it reads

Both spellings a CASL integration produces under that key: the object form
`{ action: 'read', subject: 'Order' }` and the tuple form `['read', 'Order']`, which is CASL's own
`AbilityTuple`. A subject given as a class is named by the class, since `SubjectType` in CASL is
`string | SubjectClass` and a class is how CASL itself addresses one. A single entry is accepted as
well as an array. Each pair is rendered `action:subject`, duplicates are dropped, and the list goes
into `IRNodeRuntime.scopes`, the field the reference already shows a permission in; no new shape was
added for a vocabulary difference. An entry whose action or subject cannot be named yields nothing
and is not counted as a policy handler.

The package is resolved through its entry point rather than its manifest, because `@casl/ability`
publishes an `exports` map that does not list `./package.json`, so asking for the manifest answers
`ERR_PACKAGE_PATH_NOT_EXPORTED` on a copy that is installed and working. `resolve` walks the lookup
and hands back a path: nothing here executes a line of CASL.

## A worked example

```ts
// orders.controller.ts
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CheckAbilities } from './abilities.decorator';
import { AbilitiesGuard } from './abilities.guard';

@Controller('orders')
@UseGuards(AbilitiesGuard)
export class OrdersController {
  @Get()
  @CheckAbilities({ action: 'read', subject: 'Order' })
  list() {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Order' }, { action: 'read', subject: 'Customer' })
  place() {}
}
```

```ts
// app.module.ts
OpenRefModule.forRoot({
  runtime: {
    collectors: [caslCollector({ metadataKey: ABILITIES_KEY })],
  },
});
```

`GET /orders` then shows `read:Order` and `POST /orders` shows `create:Order, read:Customer`, in the
order the decorator declared them.

## What the reference page shows

`scopes` is an `IRFact<readonly string[]>`, so the abilities land on the `Scopes` row: the parity
scale of the default theme, and the `Scopes` row of the runtime block a theme like telltale draws.
The values are joined with `, ` and drawn against the scopes the specification's own security
requirements declare, under the `scope-drift` rule, which is why the rendering is `action:subject`
and not a vocabulary of this project's own.

Beside them sits a provenance tag, `DRV`, whose tooltip reads `derived, caslCollector`. `derived` is
the level for a value read out of metadata under a key the host named: nothing about it was inferred,
and nothing about it was written by a decorator this project defines, which is what `declared` would
mean.

## What it refuses to read

Both refusals below produce a `problems()` record, and the registry drains those into
`openref doctor`, where one prints as `DRIFT  RT070  OrdersController.list` with the action on an
arrow line under it. The reason and the detail are in `--json` only, and there the reason arrives
prefixed with `caslCollector`.

- **A policy handler.** The usual CASL integration stores a function of the ability and the request
  under the same key. That function is guard logic and is never read, so it produces no fact at all.
  Such a handler usually looks like `(ability) => ability.can('read', Order)`, and a parser over that
  string would be right most of the time and silently wrong the rest, which is worse than silence.
  The finding counts them, and its action is
  `declare the action and the subject as data if they should be in the reference`. A route whose
  entries are all functions therefore reports no scopes and one finding, not an empty list.
- **A key it was not given.** Guessing one would mean reporting somebody else's metadata as this
  route's facts. Registering the collector with no key, or with an empty string, returns a skip whose
  reason says the key belongs to your application.

Neither the ability conditions nor the fields CASL carries beside an action and a subject are read.
An ability is a pair here, and a `can` rule with a condition object is still just its pair.

## When nothing appears

The `Scopes` cell tells you which of four situations you are in, and `openref doctor` is the second
half of the same answer:

1. **The collector is not registered.** The cell reads
   `No registered collector reports scopes. Add scopesCollector or declarationsCollector or caslCollector to the collectors option, or write one that does.`
   Nothing about it appears in `doctor`.
2. **`@casl/ability` is absent, or no key was passed.** The factory returns a skip and `doctor`
   prints it under `Collectors that did not run:`, one line, the collector name and the reason.
3. **The collector ran and this route has nothing.** The cell names the collector and says it
   examined the route and reported no scope for it. A key that does not match the one your decorator
   writes looks exactly like this on every route, which is the case the summary line
   `Runtime collectors that reported a fact` exists to catch: a collector that reported on no node in
   the whole document is usually a key mismatch.
4. **It read something and could not state it.** The route appears in the findings, with the policy
   handler action above.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`. `problems()` is read
structurally beside it, so the contract itself stays at two members.

It is fail open. When `@casl/ability` is not installed, or when the collector was registered without
a metadata key, the factory returns a `SkippedCollector` naming what was missing rather than a
collector. Nothing runs, the reference renders without the fact, and the name and the reason still
reach `IRRuntimeMeta.skipped`.

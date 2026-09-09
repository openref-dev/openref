# @openref/collector-access-control

Reads the `accesscontrol` grants a route declares under a metadata key your application names, and
reports the roles they name as the roles the endpoint requires. The library ships no decorator of
its own, so that key belongs to your project: there is no default and no candidate list, and passing
the key is how you tell the collector where to look.

## Install

```sh
npm install @openref/collector-access-control @openref/nest accesscontrol
```

`@openref/core` is a peer as well, for the types the facts are declared in. It arrives with
`@openref/nest`, so there is nothing extra to install for it. `accesscontrol` is an optional peer:
without it the factory declines rather than failing to load.

## Use

```ts
import { OpenRefModule } from '@openref/nest';
import { accessControlCollector } from '@openref/collector-access-control';
import { GRANTS_KEY } from './grants.decorator';

OpenRefModule.forRoot({
  runtime: {
    collectors: [accessControlCollector({ metadataKey: GRANTS_KEY })],
  },
});
```

| Option        | Type               | Default                  | Required |
| ------------- | ------------------ | ------------------------ | -------- |
| `metadataKey` | `string \| symbol` | none                     | yes      |
| `isInstalled` | `() => boolean`    | resolves `accesscontrol` | no       |

`metadataKey` is the key your own grant decorator writes under. It has to be the same value your
decorator passes to `SetMetadata` and the same value your guard passes to `Reflector`, because all
three are looking up one entry in one table: a key that differs by a character reads as a route that
declared nothing. Registering the collector without one is not an error, it is a skip that says so.

`isInstalled` is a test seam. A host passes nothing for it.

## Both sides of the key

The application writes the metadata:

```ts
// grants.decorator.ts
import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

/** The key this application writes its grants under. There is no default and none is guessed. */
export const GRANTS_KEY = 'app.grants';

/** The four fields of an `accesscontrol` grant, of which only the role is reported. */
export interface Grant {
  readonly role: string | string[];
  readonly resource: string;
  readonly action: string;
  readonly possession?: 'own' | 'any';
}

export function Grants(...grants: Grant[]): CustomDecorator {
  return SetMetadata(GRANTS_KEY, grants);
}
```

The collector reads it, through Nest's own `Reflector.getAllAndOverride` over the handler and then
the controller, so the handler's declaration replaces the class's rather than adding to it. That is
the same lookup a guard of your own would make, which is what makes the reported list the one the
guard receives rather than an approximation of it.

## What it reads

The role names, and only those. A grant carries a role, a resource, an action and a possession, which
is the shape `accesscontrol` calls `IAccessInfo`, while `IRNodeRuntime.roles` is a list of strings, so
the honest reduction is the role. `role` is read as either a string or an array of strings, both of
which the library accepts, and a bare string entry is read as a role too, which is what an
application writes when its decorator carries roles and nothing else. Duplicates are dropped and the
declaration order is kept.

Rendering `admin:read:own:order` instead would put a vocabulary this project does not define into a
field readers compare against the specification's security requirements, and the comparison would
never match. The dropped detail is not dropped quietly: see the refusals below.

The package is resolved through its entry point rather than its manifest. `accesscontrol` publishes
no `exports` map and would have worked either way, and it is written the same as the CASL collector
beside it for exactly that reason: the library that would break under a manifest lookup is not the
one anybody tests first. `resolve` walks the lookup and hands back a path, so nothing here executes a
line of `accesscontrol`.

## A worked example

```ts
// reports.controller.ts
import { Controller, Delete, Get, UseGuards } from '@nestjs/common';
import { Grants } from './grants.decorator';
import { GrantsGuard } from './grants.guard';

@Controller('reports')
@UseGuards(GrantsGuard)
export class ReportsController {
  @Get()
  @Grants({ role: ['analyst', 'admin'], resource: 'report', action: 'read', possession: 'any' })
  list() {}

  @Delete(':id')
  @Grants({ role: 'admin', resource: 'report', action: 'delete', possession: 'any' })
  remove() {}
}
```

```ts
// app.module.ts
OpenRefModule.forRoot({
  runtime: {
    collectors: [accessControlCollector({ metadataKey: GRANTS_KEY })],
  },
});
```

`GET /reports` then shows `analyst, admin` and `DELETE /reports/{id}` shows `admin`. The resource,
the action and the possession are read and deliberately not carried onto the page.

## What the reference page shows

`roles` is an `IRFact<readonly string[]>`, so the names land on the `Roles` row: the parity scale of
the default theme, and the `Roles` row of the runtime block a theme like telltale draws. The values
are joined with `, `. The specification side of that row is always `not described`, with the note
`OpenAPI has no field for roles`, and no rule of the drift catalogue examines the row yet, so its
verdict is the `?` glyph rather than a match or a drift. That is the row saying the comparison did
not run, not that it failed.

Beside the value sits a provenance tag, `DRV`, whose tooltip reads `derived, accessControlCollector`.
`derived` is the level for a value read out of metadata under a key the host named: nothing about it
was inferred, and nothing about it was written by a decorator this project defines, which is what
`declared` would mean.

## What it refuses to read

The first three refusals below produce a `problems()` record, and the registry drains those into
`openref doctor`, where one prints as `DRIFT  RT070  ReportsController.list` with the action on an
arrow line under it. The reason and the detail are in `--json` only, and there the reason arrives
prefixed with `accessControlCollector`.

- **A permission computed in code.** A grant stored as a function is guard logic and produces no
  fact. The finding counts them, and its action is
  `declare the role as data if it should appear in the reference`. A route whose entries are all
  functions therefore reports no roles and one finding, not an empty list.
- **A grant that names no role.** An entry with a resource and an action and no `role` says who may
  not do something rather than who may, and the reference reports who may. It is counted, with the
  action `name the role on the grant if it should appear in the reference`.
- **A key it was not given.** Guessing one would mean reporting somebody else's metadata as this
  route's facts. Registering the collector with no key, or with an empty string, returns a skip whose
  reason says to pass the key your own grant decorator writes under.
- **A query against the grant table.** An `accesscontrol` integration usually asks that table a
  question at request time, `ac.can(role).readAny(resource)` or its neighbours, and the question is
  guard logic, which is never read. There is nothing to record for it because there is nothing under
  a key to see: the reference reports the declaration, and the query is not one.

## When nothing appears

The `Roles` cell tells you which of four situations you are in, and `openref doctor` is the second
half of the same answer:

1. **The collector is not registered.** The cell reads
   `No registered collector reports roles. Add rolesCollector or accessControlCollector to the collectors option, or write one that does.`
   Nothing about it appears in `doctor`.
2. **`accesscontrol` is absent, or no key was passed.** The factory returns a skip and `doctor`
   prints it under `Collectors that did not run:`, one line, the collector name and the reason.
3. **The collector ran and this route has nothing.** The cell names the collector and says it
   examined the route and reported no role for it. A key that does not match the one your decorator
   writes looks exactly like this on every route, which is the case the summary line
   `Runtime collectors that reported a fact` exists to catch: a collector that reported on no node in
   the whole document is usually a key mismatch.
4. **It read something and could not state it.** The route appears in the findings, with the action
   for whichever of the two records above applied.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`. `problems()` is read
structurally beside it, so the contract itself stays at two members.

It is fail open. When `accesscontrol` is not installed, or when the collector was registered without
a metadata key, the factory returns a `SkippedCollector` naming what was missing rather than a
collector. Nothing runs, the reference renders without the fact, and the name and the reason still
reach `IRRuntimeMeta.skipped`.

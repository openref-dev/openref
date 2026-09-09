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
`@openref/nest`, so there is nothing extra to install for it.

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

`metadataKey`, a string or a symbol, is the only option and it is required.

## What it reads

The role names, and only those. A grant carries a role, a resource, an action and a possession,
while `IRNodeRuntime.roles` is a list of strings, so the honest reduction is the role. A bare string
is accepted too, which is what an application writes when its decorator carries roles and nothing
else, and `role` as either a string or an array is read. Rendering `admin:read:own:order` instead
would put a vocabulary this project does not define into a field readers compare against the
specification's security requirements, and the comparison would never match. The handler's
declaration overrides the controller's, through Nest's own `getAllAndOverride`.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`.

It is fail open. When `accesscontrol` is not installed, or when the collector was registered without
a metadata key, the factory returns a skip naming what was missing rather than a collector. Nothing
runs and the reference renders without the fact. The package is resolved and never loaded: nothing
here executes a line of `accesscontrol`.

Every fact it emits carries a confidence, `derived` here, and the collector name
`accessControlCollector`, so a reader can tell an observation of the application from a promise
somebody typed.

What it deliberately never claims:

- A query against the grant table. An `accesscontrol` integration usually asks that table a question
  at request time, and the question is guard logic, which is never read.
- A permission computed in code. A grant stored as a function produces no fact.
- A key it was not given. Guessing one would mean reporting somebody else's metadata as this route's
  facts.

The detail it drops is not dropped quietly: a grant that is a function and a grant that names no
role at all are both recorded as findings, out of `problems()`, which the collector registry drains
into `openref doctor`.

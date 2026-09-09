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
`@openref/nest`, so there is nothing extra to install for it.

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

`metadataKey`, a string or a symbol, is the only option and it is required.

## What it reads

Both spellings a CASL integration produces under that key: the object form `{ action: 'read',
subject: 'Order' }` and the tuple form `['read', 'Order']`. A subject given as a class is named by
the class, which is how CASL itself addresses one. Each pair is rendered as `action:subject` and the
list goes into `IRNodeRuntime.scopes`, the field the reference already shows a permission in; no new
shape was added for a vocabulary difference. The handler's declaration overrides the controller's,
through Nest's own `getAllAndOverride`.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`.

It is fail open. When `@casl/ability` is not installed, or when the collector was registered without
a metadata key, the factory returns a skip naming what was missing rather than a collector. Nothing
runs and the reference renders without the fact. The package is resolved and never loaded: nothing
here executes a line of CASL.

Every fact it emits carries a confidence, `derived` here, and the collector name `caslCollector`, so
a reader can tell an observation of the application from a promise somebody typed.

What it deliberately never claims:

- A policy handler. The usual CASL integration stores a function of the ability and the request
  under the same key. That function is guard logic and is never read, so it produces no fact at all.
  Such a handler usually looks like `(ability) => ability.can('read', Order)`, and a parser over
  that string would be right most of the time and silently wrong the rest, which is worse than
  silence.
- A key it was not given. Guessing one would mean reporting somebody else's metadata as this route's
  facts.

Where a fact cannot be obtained it records a finding instead of guessing, naming how many policy
handlers on the route were functions and what is therefore unknown. Those come out of `problems()`,
which the collector registry drains into `openref doctor`.

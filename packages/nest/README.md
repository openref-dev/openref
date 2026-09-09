# @openref/nest

The package a consumer installs. It mounts an API reference on a running NestJS application, serves
every route of it from that application, and reads what the application knows about its own handlers.
The specification describes how the API looks; the running application knows how it behaves; this is
the package that joins the two.

## Install

```sh
npm i @openref/nest
```

`@nestjs/common` and `@nestjs/core` are peer dependencies, `^10.0.0 || ^11.0.0`, and a NestJS
application already has them. Nothing else is needed: the renderer, the default theme, the request
runner and the search index are bundled in.

## Use

```ts
import { OpenRefModule } from '@openref/nest';

OpenRefModule.setup('/docs', app, { document });
```

`document` is the object `@nestjs/swagger` already builds. `setup` is synchronous on purpose, because
routes have to exist before `app.listen()` and a promise a host forgets to await registers them after
the first requests arrive; everything expensive is built on first use behind the service instead. The
routes go onto the http adapter directly rather than onto a controller, which is how a documentation
route avoids sitting behind whatever guards and interceptors the application applies globally.

## The two entry points, and why there are two

`setup` takes a route, an application and a document, and carries no runtime options at all. That is
a consequence rather than a preference: everything the runtime pass reads needs the controller
classes, the only public route to them is `DiscoveryService`, and a service is injectable only into
something the container instantiates, which `setup` is not. So `forRoot` is the form that collects
facts, and nothing is registered unasked:

```ts
import { guardsCollector, OpenRefModule, scopesCollector, sourceCollector } from '@openref/nest';

OpenRefModule.forRoot({
  runtime: {
    collectors: [
      guardsCollector(),
      scopesCollector({ metadataKey: SCOPES_KEY }),
      sourceCollector(),
    ],
    sourceLink: 'https://github.com/org/repo/blob/{ref}/{file}#L{line}',
  },
});
```

A host that imports it gets those facts on whatever `setup` mounts afterwards, because `setup` asks
the container whether the pass is there. `forRootAsync` takes a factory, for a host whose document
comes out of a configuration provider.

## Every runtime fact carries where it came from

A collector returns an `IRNodeRuntime`, and each field of it that holds a value holds it in an
`IRFact` carrying a `confidence` and the `collector` name. There is no overload, no union and no cast
in the contract that admits a bare value. Three levels, and no others: `declared`, a decorator
somebody wrote; `derived`, metadata under a key the host named; `inferred`, a compile time reading
that is best effort and says so.

Nothing is guessed to fill a gap. A guard class is not turned into a security scheme name, the route
exemption key has no default and is never sniffed for, and an endpoint's error list is never derived
from an exception filter, because a filter says how to handle X rather than that this endpoint can
raise X. Where a fact cannot be had, the page says the comparison did not run and `doctor` reports it.

## Collectors fail open

A collector factory whose optional package is absent returns a `SkippedCollector` instead of throwing,
and the registry never calls it. Its name and the reason still reach `IRRuntimeMeta.skipped`, so the
absence reads as "throttler facts are missing because `@nestjs/throttler` is not installed" rather
than as an empty panel. The contract itself is two members, `name` and `collect`, and it is frozen
public API: third parties publish collectors against it, so changing it is a major version.

## Headers, and what this module will not send

It writes no `Content-Security-Policy`. What it guarantees is that its own output is compatible with
a strict one: no inline style, no inline script, a nonce on what needs one, no CDN and no outgoing
request of any kind. `buildContentSecurityPolicy` is re-exported here so the host can build the
header it is the host's job to send.

`DISTRIBUTION.md` beside this file covers the four ways the client ships and which theme levels each
DOM mode supports, including the light DOM web component, which is a supported mode and not a
workaround.

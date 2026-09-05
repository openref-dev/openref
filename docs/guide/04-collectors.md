## Collectors

A collector reads one kind of fact off your running application. You register the ones whose
facts you want, and none of them run unless you do:

```ts
OpenRefModule.forRoot({
  runtime: {
    collectors: [
      sourceCollector(),
      guardsCollector(),
      declarationsCollector(),
      streamCollector(),
      scopesCollector({ metadataKey: SCOPES_KEY }),
      errorsCollector({ catalogs: [ORDER_ERRORS] }),
      pipesCollector(),
      timeoutCollector({ metadataKey: TIMEOUT_KEY }),
      headersCollector({ metadataKey: REQUIRED_HEADERS_KEY }),
      handlerScanCollector(),
      httpCodeCollector(),
    ],
    sourceLink: 'https://github.com/org/repo/blob/{ref}/{file}#L{line}',
  },
});
```

| Collector | Reads |
| --- | --- |
| `sourceCollector` | where the handler is written, from V8 and the source map |
| `guardsCollector` | the guard class names in front of the route |
| `scopesCollector` | scopes, from a metadata key you name |
| `rolesCollector` | roles, from a metadata key you name |
| `pipesCollector` | the pipes bound to the route, with their scope |
| `timeoutCollector` | a timeout, from a metadata key you name |
| `headersCollector` | required headers, from a metadata key you name |
| `httpCodeCollector` | the success status `@HttpCode` sets |
| `streamCollector` | that a route streams, and its item type when declared |
| `declarationsCollector` | what this package's own decorators declared |
| `errorsCollector` | error contracts, from catalogs you supply |
| `handlerScanCollector` | which declared parameters the handler actually binds |

`throttlerCollector` lives in its own package, `@openref/collector-throttler`, so that
installing `@openref/nest` never puts a rate limiting library in the dependency closure of an
application that does not rate limit anything. The same is true of
`@openref/collector-casl`, `@openref/collector-access-control` and
`@openref/collector-redisx-rate-limit`, which reads `@nestjs-redisx/rate-limit`.

Register at most one collector per fact. Two that report the same fact at the same confidence are
resolved by registration order, first wins, and the `doctor` report names the pair and the value it
dropped so the choice is never silent.

### What a collector cannot read, it says

A rate limit written on a route is a fact. A rate limit applied by a guard your application
registered for everything is not: what that guard decides is in its own code, which no collector
ever reads. So a route with no limit of its own and a globally registered guard over it does not
come back empty. It comes back with a line in `openref doctor` naming the guard, and the module wide
budget if one is configured, and saying that nothing observed connects the two. An unlimited route
and a route whose limit is unreadable must not look the same, and this is where they stop looking
the same.

### Every fact carries where it came from

```ts
const runtime = {
  scopes: { value: ['orders:read'], confidence: 'declared', collector: 'scopesCollector' },
};
```

<!-- gen: count:list -->Three<!-- /gen --> levels, and no fourth:

- **`declared`**: you wrote it explicitly, with a decorator
- **`derived`**: read from metadata under a key that was explicitly configured
- **`inferred`**: a compile time AST plugin's best effort

A bare value with no provenance is not accepted anywhere in the model. That is what lets the
page tell you whether a scope is a promise somebody typed or an observation of the application.

### The <!-- gen: count:list -->three<!-- /gen --> things that are impossible, and are never faked

1. **Reading what a guard decides.** `ScopesGuard` is a class name. What it checks is code, and
   code is not readable as data. Only metadata under a key you configured is readable.
2. **Deriving an endpoint's full error list from exception filters.** See the previous section.
3. **Recovering a generic parameter through reflection.** It is not in the compiled output.

When a fact cannot be obtained, the reference emits a `doctor` warning naming what it could not
read. It never substitutes a guess. That is the difference between a route that needs no scopes
and a route whose scopes are unreadable, and a reader cannot tell those apart from a blank.

### Naming a metadata key

There is no default key and there never will be one, because guessing your application's key
would mean reporting somebody else's metadata as your route's facts:

```ts
export const SCOPES_KEY = 'orders:scopes';
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);
```

```ts
OpenRefModule.forRoot({ runtime: { collectors: [scopesCollector({ metadataKey: SCOPES_KEY })] } });
```

### Writing your own

The contract is public and frozen, and both members are in the block below:

```ts
export interface IRuntimeCollector {
  readonly name: string;
  collect(context: CollectorContext): IRNodeRuntime | undefined;
}
```

`context` hands you the normalized node, the controller class, the handler, the class the
handler was declared on, Nest's `Reflector` and `ModuleRef`, the global guards and pipes, and
`fact(value, confidence)`, which is how a value becomes a fact with provenance. Returning
`undefined` means this collector has nothing to say about this node.

This one turns an authorization library's ability rules into the scopes a route requires, which
is the shape most hand written collectors have:

```ts
export const ABILITY_COLLECTOR_NAME = 'abilityCollector';

interface AbilityRule {
  readonly action: string;
  readonly subject: string;
}

function isAbilityRule(value: unknown): value is AbilityRule {
  if (typeof value !== 'object' || value === null) return false;
  const rule = value as { action?: unknown; subject?: unknown };
  return typeof rule.action === 'string' && typeof rule.subject === 'string';
}

export function abilityCollector(options: { readonly metadataKey: string }): IRuntimeCollector {
  return {
    name: ABILITY_COLLECTOR_NAME,

    collect(context: CollectorContext) {
      const declared: unknown = context.reflector.get(options.metadataKey, context.handler);
      if (!Array.isArray(declared)) return undefined;

      const scopes = declared.filter(isAbilityRule).map((rule) => `${rule.subject}:${rule.action}`);
      if (scopes.length === 0) return undefined;

      return { scopes: context.fact(scopes, 'derived') };
    },
  };
}
```

`derived` and not `declared`, because the rules were read from a metadata key rather than
written as a statement about this route. Getting that level wrong is the one way a collector
can lie.

Note what is not annotated: `collect` returns `IRNodeRuntime | undefined`, and that type lives
in `@openref/core`, which `@openref/nest` does not re-export. Writing the annotation costs you a
second package for one name, so the literal is left to be checked against `IRuntimeCollector`
instead, which checks the same thing.

Collectors are fail open. A collector that throws, or one whose optional package is not
installed, is skipped and reported; it never takes the reference down with it. That is the
opposite of the normalizer's policy, which is fail closed, because a broken specification that
renders as if it were fine is a lie and a missing optional fact is not.

`examples/runtime-intelligence` in the repository is a complete application built around a
collector written this way.

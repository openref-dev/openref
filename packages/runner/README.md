# @openref/runner

The engine behind the try-it console, per SPEC 14. It takes a projection of one operation and what a
reader typed into it, plans the request, serializes every parameter and the body, applies credentials,
sends it, and reads the answer back. It also holds the OAuth2 session surface, the streaming reader
and the WebSocket client.

It never sees an `IRDocument`. What it is handed is a plain JSON projection that can travel inside a
rendered page, so nothing here depends on Vue, on a DOM beyond `fetch`, or on the document being
present at send time.

## Install

```sh
npm install @openref/runner
```

No peer dependencies. `@openref/core` comes with it, for the IR parameter types and the error classes.

## Use

```ts
import { createRunner } from '@openref/runner';

const runner = createRunner({ visibility: 'public' });

const result = await runner.send({
  operation, // a RunnableOperation: method, path, parameters, servers, security, body media types
  serverUrl: 'https://api.example.com',
  values: { 'query:color': { kind: 'array', value: ['blue', 'black'] } },
});

result.status; // 200
result.durationMs; // wall clock from the call to the body being read
```

Values are keyed by `${location}:${name}`, and a missing key is not an empty one. An absent value
means the reader filled nothing in and the parameter does not appear; an empty value means they
cleared the field and the request carries `color=`. Those are different requests, and the runner
sends whichever one was asked for.

Credentials live in the runner rather than travelling in the send call, so nothing above it ever
holds one, and a `visibility` of `public` refuses prefilled credentials at the type level.

## The serialization matrix is the product

`style x explode x location x value type`, whole: seven styles, `explode` either way, four locations,
and three value kinds. Every cell is implemented or refused by name with a `SerializationError`, and
there is no third behaviour: nothing falls back to a nearby style. A console that renders `deepObject`
as `form` sends a request that looks sent, comes back 400, and reads to the reader as the API being
broken.

OpenAPI leaves eleven cells undefined and says nothing about an empty array, an empty object, or
whether a delimiter is percent encoded. Silence is not permission to guess quietly: each choice is
stated where it is made, and the case in `serialization-matrix.spec.ts` that pins it carries the
chosen behaviour in its own title.

An object is ordered pairs and not a record, for the reason the canonical serialization rule exists
one package over: every exploded style renders an object field by field, so field order is visible in
the request, and a record with integer-like keys would reorder what the reader wrote.

## Transports, and the closed direction

| Transport                  | What it does                                                        |
| -------------------------- | ------------------------------------------------------------------- |
| `FetchHttpTransport`       | Direct mode: the browser sends the request, with its own CORS rules |
| `ProxyHttpTransport`       | Same origin mode: the documentation server puts it on the wire      |
| `PathRewriteHttpTransport` | A static build's rewrite rules, for a host that has them            |

The proxy transport refuses to be clever. Its endpoint must be an absolute path on this origin and
the constructor throws otherwise, so this transport cannot address another origin; the request is a
JSON envelope in a body rather than a url to rewrite, and whether that url may be reached at all is
the server's decision, in `@openref/nest`, where the allowlist lives. Credentials are omitted on the
fetch to our own origin, since the reader's cookies for the documentation site have no business
travelling with a request whose purpose is to reach the API.

A token endpoint or an OpenID discovery document that answers with a redirect is refused rather than
followed, because that request carries a client secret, a code verifier or the reader's password. An
ordinary API request keeps following redirects, which is what a browser does for anything else the
page sends.

## Two narrower entry points

`@openref/runner/http` and `@openref/runner/socket` are doors onto the same modules for a bundler
that needs the smaller ones: a chunk that sends a request should not be a chunk that opens a socket.
The barrel still exports every name on both, and `test/unit/entry-parity.spec.ts` holds the three
surfaces equal rather than anybody remembering to add a name in three places.

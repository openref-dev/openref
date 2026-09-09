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

## `createRunner(options)`

`visibility` is the only required member. Everything else has a default or is an injection point.

| Option            | Type                                        | Default                          | What it is                                                      |
| ----------------- | ------------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `visibility`      | `'internal' \| 'public'`                    | required                         | Whether the reference is reachable by anyone                    |
| `credentials`     | `Record<string, string>`, `never` if public | absent                           | Credentials supplied ahead of time, keyed by scheme id          |
| `storage`         | `'memory' \| 'session' \| 'local' \| 'off'` | `'session'`                      | Where a credential a reader types is kept                       |
| `storageBacking`  | `KeyValueStorage`                           | the store the mode names         | For a host with its own, or a test with a plain object          |
| `transport`       | `IHttpTransport`                            | `new FetchHttpTransport()`       | What puts the bytes on the wire                                 |
| `streamTransport` | `IStreamTransport`                          | none, deliberately               | What opens a stream; without one, `stream()` is refused         |
| `maxBodyBytes`    | `number`                                    | `8 * 1024 * 1024`                | How large a request body the console will build                 |
| `boundary`        | `() => string`                              | crypto random, counter otherwise | The multipart boundary, drawn once per send                     |
| `pendingStorage`  | `KeyValueStorage`                           | `sessionStorage` when usable     | Where a pending authorization waits out a full page redirect    |
| `random`          | `RandomBytes`                               | none, deliberately               | Random bytes for PKCE and `state`; there is no insecure default |
| `now`             | `() => number`                              | `Date.now`                       | The clock, so a duration can be measured without waiting        |
| `wait`            | `(ms: number) => Promise<void>`             | real `setTimeout`                | Between device flow polls                                       |

The runner it returns answers `send`, `stream`, `credential`, `setCredential`, `signIn`, `signOut`,
`sessionStatus`, `renew`, `discover`, `completeAuthorization` and `completeDeviceAuthorization`.

`send` takes `{ operation, serverUrl, values, body?, mediaType? }` and resolves a `RunResult`:
`status`, `statusText`, `headers`, `body`, `durationMs`, and a `notice` when something happened to
the session while the request was being answered. It carries no plan and no credentials back. A
`serverUrl` that is not one of `operation.servers` is a `SerializationError`, and an operation with
no servers at all is an `InvalidOptionsError`.

On a 401 against a renewable OAuth2 or OpenID Connect session, `send` refreshes once and retries
once. Never a loop, and the boundary drawn for the first attempt is reused by the second, so the two
requests are the same bytes.

## The serialization matrix is the product

`style x explode x location x value type`, whole: seven styles, `explode` either way, four locations,
and three value kinds. Every cell is implemented or refused by name with a `SerializationError`, and
there is no third behaviour: nothing falls back to a nearby style. A console that renders `deepObject`
as `form` sends a request that looks sent, comes back 400, and reads to the reader as the API being
broken.

| Style            | Locations         | `explode` | Value kinds                    |
| ---------------- | ----------------- | --------- | ------------------------------ |
| `form`           | `query`, `cookie` | either    | `primitive`, `array`, `object` |
| `simple`         | `path`, `header`  | either    | `primitive`, `array`, `object` |
| `label`          | `path`            | either    | `primitive`, `array`, `object` |
| `matrix`         | `path`            | either    | `primitive`, `array`, `object` |
| `spaceDelimited` | `query`           | `false`   | `array`, `object`              |
| `pipeDelimited`  | `query`           | `false`   | `array`, `object`              |
| `deepObject`     | `query`           | `true`    | `object`                       |

A value is one of three shapes and nothing else: `{ kind: 'primitive', value: string }`,
`{ kind: 'array', value: readonly string[] }`, and
`{ kind: 'object', value: readonly (readonly [string, string])[] }`. `serializeParameter` is the
entry point, and `assertCellDefined` is the refusal, which names the row it failed against.

Worked, with a parameter called `color` in `query`:

```
form,       explode true,  ['blue','black','brown']   ->  color=blue&color=black&color=brown
form,       explode true,  [['R','100'],['G','200']]  ->  R=100&G=200
deepObject, explode true,  [['R','100'],['G','200']]  ->  color[R]=100&color[G]=200
```

The exploded `form` object drops the parameter's own name, which is why the exploded empty object is
the one cell that renders nothing at all. `deepObject` writes its brackets literally and encodes only
the key inside them, because an encoded bracket is a different parameter name to a server that does
not decode before matching.

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

`FetchHttpTransport` takes `{ fetch?, timeoutMs?, maxResponseBytes? }`, defaulting to 30000 ms and
8 MiB. `ProxyHttpTransport` takes `{ endpoint, fetch?, timeoutMs? }` and `PathRewriteHttpTransport`
takes `{ prefix, upstreams, fetch? }`. `FetchStreamTransport` is the streaming reader, and
`NativeWebSocketTransport` and `SocketIoTransport` are the two socket clients.

The proxy transport refuses to be clever. Its endpoint must be an absolute path on this origin and
the constructor throws otherwise, so this transport cannot address another origin; the request is a
JSON envelope in a body rather than a url to rewrite, and whether that url may be reached at all is
the server's decision, in `@openref/nest`, where the allowlist lives. Credentials are omitted on the
fetch to our own origin, since the reader's cookies for the documentation site have no business
travelling with a request whose purpose is to reach the API. It also refuses a byte body at send
time and says to use direct mode, rather than silently sending something else; the path rewrite
transport, which is a real rewrite rather than an envelope, forwards bytes.

A token endpoint or an OpenID discovery document that answers with a redirect is refused rather than
followed, because that request carries a client secret, a code verifier or the reader's password. An
ordinary API request keeps following redirects, which is what a browser does for anything else the
page sends.

## Credentials and the five OAuth2 flows

`setCredential(schemeId, value)` writes and `credential(schemeId)` reads; an empty value clears. The
storage mode decides where it lives, and `applyCredentials` turns the schemes plus the values into
headers and query pairs. A scheme that cannot be sent from a browser at all, mutual TLS, a cookie
API key, or an HTTP challenge, raises an `AuthError` naming which, rather than being sent wrong.

`signIn(schemeId, flow, client, redirect?)` covers `authorizationCode`, `clientCredentials`,
`password`, `implicit` and `deviceAuthorization`, and answers one of three outcomes: signed in, a url
to send the reader to, or a device authorization to display. `completeAuthorization(params)` is what
the redirect comes back into, `completeDeviceAuthorization(schemeId)` polls, `sessionStatus` reports,
`renew` refreshes and `signOut` ends. `discover(openIdConnectUrl)` reads a provider's own document
into the flow list.

A refresh token stays in memory under every storage mode, `local` included, and there is no timer:
renewal happens on a 401 after a Send and at no other moment.

## Two narrower entry points

`@openref/runner/http` and `@openref/runner/socket` are doors onto the same modules for a bundler
that needs the smaller ones: a chunk that sends a request should not be a chunk that opens a socket.
The barrel still exports every name on both, and `test/unit/entry-parity.spec.ts` holds the three
surfaces equal rather than anybody remembering to add a name in three places.

The split is a measurement rather than a taxonomy. Before it, a reader who pressed Send downloaded
8010 raw bytes of socket engine along with the request they wanted, and the size budget for the send
chunk read 74297 against a cap of 73200.

/**
 * The send half of this package on its own entry, so a chunk that sends a request is not a chunk
 * that opens a socket.
 *
 * IT IS THE OTHER HALF OF `./socket` AND IT EXISTS FOR A MEASUREMENT, not for symmetry. A bundler
 * assigns a module to the chunk shared by every entry point that can reach it, and reaching is a
 * property of the import graph rather than of the symbols a caller names. So while the console's
 * factory imported `./socket` and the request runner's factory imported the barrel, the socket
 * engine was still reachable from both, because the barrel re-exports it: measured on the served
 * bundle, 8,010 raw bytes of socket engine sat in a chunk a reader who pressed Send downloaded,
 * and `client-js-send-raw` read 74,297 against a cap of 73,200. With both factories on a narrow
 * entry neither reaches the other's engine and the shared chunk goes away.
 *
 * WHAT IS HERE IS WHAT THE SERVED CONSOLE'S FACTORY CONSTRUCTS AND NOTHING ELSE, which is the
 * whole reason it is narrow. A wider entry would put the barrel back one name at a time, and it
 * costs something else measured: every name two entries both export is a name
 * `published-surface-agreement.spec.ts` compares as a type across both doors, so `RunnerOptions`
 * on this entry made the probe write a generic whose constraint it could not resolve. The barrel
 * is where a consumer reads the whole surface; this is where a bundler reaches one engine.
 *
 * THE BARREL IS UNCHANGED AND STILL EXPORTS EVERY NAME BELOW, which is what keeps this additive: a
 * consumer that imports `@openref/runner` gets exactly what it always got, and these two entries
 * are narrower doors onto the same modules for a bundler that needs them. The three surfaces are
 * held equal by `packages/runner/test/unit/entry-parity.spec.ts` rather than by anybody
 * remembering to add a name in three places.
 */

export type { IHttpTransport } from './send/application/ports/http-transport.port';

export {
  PathRewriteHttpTransport,
  type PathRewriteTransportOptions,
} from './send/infrastructure/adapters/path-rewrite-transport.adapter';

export {
  ProxyHttpTransport,
  type ProxyTransportOptions,
} from './send/infrastructure/adapters/proxy-transport.adapter';

export { createRunner, RequestRunner } from './send/application/services/runner.service';

export {
  FetchStreamTransport,
  type FetchStreamTransportOptions,
} from './stream/infrastructure/adapters/fetch-stream.adapter';

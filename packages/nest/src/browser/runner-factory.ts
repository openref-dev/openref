/**
 * The runner factory, in the chunk the Send gesture loads and in no other.
 *
 * THE BRANCH LIVES HERE BECAUSE THE MEASUREMENT SAID SO, per the T033 amendment. Written in
 * `entry.ts`, the branch and the `createRunner` call with its option literals sit in the first
 * paint chunk of every page, for a console most readers never open. Behind the gesture they
 * cost the first paint nothing, and the runner chunk merges into this one, which took bytes off
 * the Send side as well: measured on three builds of one commit, first paint minus 45, Send
 * minus 1,258.
 *
 * THE CHOICE ITSELF, per SPEC 14.5 and SPEC 16.2: the page model carries `staticProxy` exactly
 * when a static build generated rewrite rules for this deployment, and `proxyPath` exactly when a
 * host mounted the same origin envelope proxy. Either way the console sends to this page's own
 * origin and something else reaches the API; with neither, the direct transport, which is the
 * build this page always was. The facts are read off the model rather than sniffed from a route,
 * because only the producer knew, and the producer wrote it into the page.
 *
 * A PAGE CANNOT HONESTLY CARRY BOTH, AND THE ORDER SAYS WHICH WINS IF ONE EVER DOES. The two
 * facts come from opposite producers: `proxyPath` is written by the Nest module, which knows it
 * mounted a route on a running server, and `staticProxy` by the static build, which knows it
 * wrote configuration files a platform will read. A directory of files has no route to mount and
 * a running server generates no rewrite rules, so nothing produces both. If a page ever arrives
 * with both, the rules win rather than the route: a static page is the one that can be served
 * from a host that never ran this module, and addressing a route that is not there fails closed
 * where addressing a rule that is not there fails the same way. Deciding it here in writing beats
 * whichever branch happened to be first.
 *
 * IT IMPORTS `@openref/runner/http` AND NOT THE BARREL SINCE `TX-SOCKET-CONSOLE`, and that is a
 * measurement rather than tidiness. A bundler assigns a module to the chunk shared by every entry
 * point that can reach it, and the barrel re-exports the socket engine, so while this file named
 * the barrel a reader who pressed Send downloaded 8,010 raw bytes of socket engine they had no use
 * for and `client-js-send-raw` read 74,297 against a cap of 73,200. The narrow entry is the
 * `@openref/vue/runner` precedent one package down.
 *
 * VISIBILITY IS THE LITERAL `'public'`, unchanged from `entry.ts`, where the reason lives: a
 * page served by this module can hold no prefilled credential at all, and `credentials` is of
 * type `never` under this literal, so the guarantee is a compile error rather than a review
 * comment. The `client-runner` gate follows the binding into this chunk.
 */

import {
  createRunner,
  FetchStreamTransport,
  PathRewriteHttpTransport,
  ProxyHttpTransport,
  type IHttpTransport,
  type RequestRunner,
} from '@openref/runner/http';

/**
 * The two facts this factory reads off the page model.
 *
 * A structural slice rather than `Pick<PageModel, ...>`: naming the model's type would pull
 * `@openref/render/browser` into every program that type checks this file, DOM types and all,
 * and the whole model is more than the factory is owed. `hydrateReference` hands the full
 * model over and the slice matches it structurally.
 */
interface RunnerPage {
  /** The same origin proxy endpoint, absent when the host serves no proxy. */
  readonly proxyPath?: string;
  /** The generated rewrite rules of SPEC 16.2, absent when the build wrote none. */
  readonly staticProxy?: {
    /** Absolute path on this origin the rules live under. */
    readonly prefix: string;
    /** The pinned upstreams, in the `u<N>` order the rules index them by. */
    readonly upstreams: readonly string[];
  };
}

/**
 * Builds the runner for the page a reader has open.
 *
 * The return type is the runner's own class rather than `IRunnerPort`: the port is declared in
 * `@openref/vue`, which is not among this package's upstreams, and the runner satisfies it
 * structurally, which is the whole way the port works.
 *
 * @param model - The page model, whose `staticProxy` and `proxyPath` decide the transport
 * @returns The runner the console sends through
 */
export function createPageRunner(model: RunnerPage): RequestRunner {
  const transport: IHttpTransport | undefined =
    model.staticProxy !== undefined
      ? new PathRewriteHttpTransport({
          prefix: model.staticProxy.prefix,
          upstreams: model.staticProxy.upstreams,
        })
      : model.proxyPath === undefined
        ? undefined
        : new ProxyHttpTransport({ endpoint: model.proxyPath });

  return createRunner({
    visibility: 'public',
    storage: 'session',
    streamTransport: new FetchStreamTransport(),
    ...(transport === undefined ? {} : { transport }),
  });
}

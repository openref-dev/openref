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
 * THE CHOICE ITSELF, per SPEC 14.5: the page model carries `proxyPath` exactly when the host
 * mounted the same origin proxy, so the console sends through it and the whole SSRF policy
 * stands between the reader and the target. No `proxyPath`, no proxy: the direct transport,
 * which is the build this page always was. The fact is read off the model rather than sniffed
 * from a route, because only the server knew, and the server wrote it into the page.
 *
 * VISIBILITY IS THE LITERAL `'public'`, unchanged from `entry.ts`, where the reason lives: a
 * page served by this module can hold no prefilled credential at all, and `credentials` is of
 * type `never` under this literal, so the guarantee is a compile error rather than a review
 * comment. The `client-runner` gate follows the binding into this chunk.
 */

import {
  createRunner,
  FetchStreamTransport,
  ProxyHttpTransport,
  type IHttpTransport,
  type RequestRunner,
} from '@openref/runner';

/**
 * The one fact this factory reads off the page model.
 *
 * A structural slice rather than `Pick<PageModel, ...>`: naming the model's type would pull
 * `@openref/render/browser` into every program that type checks this file, DOM types and all,
 * and the whole model is more than the factory is owed. `hydrateReference` hands the full
 * model over and the slice matches it structurally.
 */
interface RunnerPage {
  /** The same origin proxy endpoint, absent when the host serves no proxy. */
  readonly proxyPath?: string;
}

/**
 * Builds the runner for the page a reader has open.
 *
 * The return type is the runner's own class rather than `IRunnerPort`: the port is declared in
 * `@openref/vue`, which is not among this package's upstreams, and the runner satisfies it
 * structurally, which is the whole way the port works.
 *
 * @param model - The page model, whose `proxyPath` decides the transport
 * @returns The runner the console sends through
 */
export function createPageRunner(model: RunnerPage): RequestRunner {
  const transport: IHttpTransport | undefined =
    model.proxyPath === undefined
      ? undefined
      : new ProxyHttpTransport({ endpoint: model.proxyPath });

  return createRunner({
    visibility: 'public',
    storage: 'session',
    streamTransport: new FetchStreamTransport(),
    ...(transport === undefined ? {} : { transport }),
  });
}

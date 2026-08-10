/**
 * THE COMPOSITION POINT. This file is the whole reason the try-it console works.
 *
 * `@openref/render` may not see `@openref/runner`: STANDARDS 3.5 gives the renderer two
 * upstreams, `core` and `vue`, and the runner is neither. So the console reaches a runner
 * through `IRunnerPort`, which is declared in `@openref/vue` and satisfied structurally, and
 * somebody who can see both packages has to put the two together. `@openref/nest` is the
 * first package that can, which is why the bundle a page loads is built here and not there.
 *
 * Until this file existed the shipped bundle called `hydrateReference()` with no runner and
 * the console rendered disabled. That was a supported build rather than a broken one, and it
 * was also SPEC 2's promise going unkept in the one artifact a reader actually loads. The
 * `client-runner` gate reads the built file for the binding so the state cannot be re-entered
 * by accident.
 *
 * VISIBILITY IS THE LITERAL `'public'`, and it is not an option. `RunnerOptions` makes
 * `credentials` of type `never` under `public`, so a prefilled credential is a compile error
 * at this call site rather than a review comment. A module option would have to travel to the
 * browser as serialized text, where a literal type cannot survive and the gate would stop
 * applying exactly where it matters. The option belongs to a host that builds its own runner,
 * which is `forRoot` in SPEC 13.2 and a later task; a page served by this module can hold no
 * prefilled credential at all, which is stronger than gating one.
 *
 * THE IMPORT IS DYNAMIC SINCE T011-R, AND THE LITERAL SURVIVED IT. The runner is 7.7 KB of a
 * bundle every reader compiles for a console most of them never open, so it now travels in the
 * console's own chunk: this function is called the first time somebody reaches for the try-it
 * panel, and not before. What did not change is the guarantee above. `visibility: 'public'` is
 * still written here, still a literal, and `credentials` is still of type `never` under it, so
 * the compile error is in the same place it was. The `client-runner` gate follows the binding
 * into the chunk rather than reading the entry file alone.
 */

import { hydrateReference } from '@openref/render/browser';

hydrateReference({
  loadRunner: async () => {
    const { createRunner } = await import('@openref/runner');

    return createRunner({ visibility: 'public', storage: 'session' });
  },
});

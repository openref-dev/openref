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
 * `client-runner` gate reads the built output for the binding so the state cannot be
 * re-entered by accident.
 *
 * WHAT IS LEFT HERE IS ONE CALL, since T033: the whole composition lives in `compose.ts`, so
 * that a themed entry, which must be built with its definition to share this bundle's one
 * `@openref/vue` instance, reuses it instead of copying the runner factory wiring. The
 * factory itself, its proxy branch and the visibility literal are documented on
 * `runner-factory.ts`, which arrives with the console rather than with the first paint.
 */

import { mountReference } from './compose';

mountReference();

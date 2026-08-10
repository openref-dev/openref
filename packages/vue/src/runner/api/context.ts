/**
 * How a runner reaches a component: `provide` and `inject`, as the document state does.
 *
 * Provided rather than imported, because the package that owns the runner is not one this
 * package may see, and because a build with no runner is a supported build. A reference
 * rendered to static files has nowhere to send a request from at render time, and a host that
 * wants a read only reference simply provides none. `useRunner` reports that as `available:
 * false` rather than as an error, which is what lets a theme render a disabled console.
 */

import { inject, provide } from 'vue';
import type { InjectionKey } from 'vue';
import type { IRunnerPort } from '../application/ports/runner.port';

/** Key a runner is provided under. */
export const RUNNER_KEY: InjectionKey<IRunnerPort> = Symbol('openref.runner');

/**
 * Makes a runner available to everything below this component.
 *
 * @param runner - Anything satisfying the port, such as a `RequestRunner`
 *
 * @example
 * setup() { provideRunner(createRunner({ visibility: 'internal' })); }
 */
export function provideRunner(runner: IRunnerPort): void {
  provide(RUNNER_KEY, runner);
}

/**
 * The runner provided above this component, if there is one.
 *
 * Returns undefined rather than throwing, unlike `useDocState`. A missing document state is a
 * theme wiring mistake; a missing runner is a deployment choice.
 *
 * @returns The runner, or undefined when this build carries none
 *
 * @example
 * const runner = useRunnerPort();
 */
export function useRunnerPort(): IRunnerPort | undefined {
  return inject(RUNNER_KEY, undefined);
}

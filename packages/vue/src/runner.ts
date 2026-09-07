/**
 * The try-it surface of `@openref/vue`, on its own entry point.
 *
 * WHY IT IS NOT ON THE MAIN BARREL, MEASURED RATHER THAN PREFERRED. A barrel the first paint
 * imports statically, re-exporting a module statically, puts that module in the first paint
 * whichever side uses the name: `packages/render` imports `@openref/vue` for the slot registry
 * and the state, so `useRunner` sat in the first paint chunk of every page at 950 bytes while
 * its only consumer was the try-it console, which arrives on a press of Send. That is the
 * session 45 sweep's one finding, and the cause is the barrel rather than the package.
 *
 * SO THE SPLIT IS ALONG THE GESTURE AND NOT ALONG THE SUBJECT. Everything a page needs before a
 * reader touches anything is on `@openref/vue`. Everything only a console needs is here, and a
 * theme that overrides `AuthPanel`, `SendButton`, `ResponseView`, `ShapeForm` or `StreamLog`
 * imports from here, which is the same boundary the shipped renderer pays for.
 *
 * THE PORT ITSELF STAYS ON THE MAIN BARREL. `RUNNER_KEY`, `provideRunner` and `useRunnerPort`
 * are how a runner is handed to a page at all, so the first paint reaches for them by
 * construction; they are 116 bytes and they are not what the sweep found.
 *
 * `prettyResponseBody` IS HERE FOR THE SAME MEASUREMENT, TAKEN AGAIN. It went on the main
 * barrel first and cost the first paint 84 raw bytes it has no use for, because a barrel the
 * first paint imports statically carries every module it re-exports. Its only two consumers
 * are the two themes' `ResponseView`, which nothing draws until a reader has pressed Send.
 */

export { prettyResponseBody } from './runner/domain/response-body';
export { useRunner, useRunnerFor } from './composables/useRunner';
export type { UseRunner, UseRunnerSendArgs, UseRunnerSignInArgs } from './composables/useRunner';

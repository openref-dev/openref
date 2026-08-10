/**
 * The browser baseline, as a library rather than as a gate run.
 *
 * A SECOND ENTRY POINT BECAUSE THE FIRST ONE RUNS. `src/index.ts` is what `pnpm gates`
 * executes, and it runs every gate on import; a harness that imported it in order to read a
 * threshold would run the whole suite as a side effect. This exports the record and the
 * ceilings and does nothing.
 *
 * The ceilings live here, in `tools/gates`, for the reason the coverage floors do: one home per
 * threshold, so there is one place it could be lowered. `tools/browser-budget` measures against
 * these rather than against a copy of its own.
 */

export { BROWSER_BASELINE_FILE, BROWSER_CEILINGS, BROWSER_STUDY_WORKFLOW } from './config.js';
export {
  checkCeilings,
  compareToBaseline,
  readBaseline,
  readBrowserBaseline,
  recordedFigure,
} from './lib/browser-baseline.js';
export type {
  BaselineIssue,
  BaselineRead,
  BaselineSpread,
  BrowserBaseline,
  MeasuredStudy,
} from './lib/browser-baseline.js';

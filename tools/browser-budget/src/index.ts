export { CHROME_ARGS, launchChrome, majorOf } from './chrome.js';
export type { LaunchedChrome } from './chrome.js';
export { currentEnvironment } from './environment.js';
export type { MeasurementEnvironment } from './environment.js';
export { bootFixture, FIXTURE_ENTRY } from './fixture/boot.js';
export type { BootedFixture } from './fixture/boot.js';
export { contentSecurityPolicy, createFixture, FIXTURE_BASE_PATH } from './fixture/app.js';
export type { FixtureDocument, FixtureOptions } from './fixture/app.js';
export {
  largeSpecification,
  memorySpecification,
  MEMORY_DOCUMENT,
  PROOF_NODE_COUNT,
  TTI_NODE_COUNT,
} from './fixture/specification.js';
export { externalRequestsOf, measurePage } from './measure.js';
export type {
  CspViolationRecord,
  MeasureOptions,
  PageMeasurement,
  RequestRecord,
  ResourceRecord,
} from './measure.js';
export {
  PLANTED_ORIGIN,
  PLANTED_SCRIPT_MARKER,
  plantExternalStylesheet,
  plantInlineScript,
  plantInlineStyleAttribute,
} from './plants.js';
export { repositoryRoot } from './repo-root.js';
export { spreadOf } from './statistics.js';
export type { Spread } from './statistics.js';
export { firstNodePage, runStudy, TTI_PAGE, TTI_PAGE_MARKER } from './study.js';
export type { ResourceSummary, StudyOptions, StudyReport } from './study.js';
export { applyVerifiedThrottle, THROTTLE_RATE, THROTTLE_TOLERANCE } from './throttle.js';
export type { ThrottleVerification } from './throttle.js';

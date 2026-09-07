/**
 * What the committed projection of `ai-docs/` has to cover, derived from the gate configuration.
 *
 * ONE PLACE RATHER THAN TWO, and the reason is the failure this repository keeps removing. The
 * generator and the gates have to agree about which SPEC 21 rows are read and which milestones
 * have a definition of done under a gate; two hand kept lists would drift, and the drift would
 * read as an artefact that simply had no entry for a row, which is silence rather than a failure.
 * Derived from the same constants the gates themselves use, a row added to a gate is a row the
 * next generation carries, and a row added without regenerating is an artefact the gate reports
 * as carrying no reading of it.
 */

import {
  BUILD_AMENDMENTS_FILE,
  BUILD_FILE,
  DEFERRAL_DOCUMENTS,
  EVENTS_MILESTONE,
  EVENTS_SUITE_ROW,
  FEDERATION_MILESTONE,
  FEDERATION_SUITE_ROW,
  M6_MILESTONE,
  M6_SUITE_ROWS,
  M7_MILESTONE,
  M7_SUITE_ROWS,
  MILESTONE_UNDER_GATE,
  REQUIRED_DOCS,
  STATIC_SUITE_ROW,
  THEME_TOKEN_STYLESHEETS,
} from '../config.js';
import { AI_DOCS_DIR } from './ai-docs.js';
import type { ProjectionRequest } from './projection.js';

/**
 * The request, with every list read off the configuration that the gates read.
 *
 * @returns What the generator must project out of `ai-docs/`
 */
export function projectionRequest(): ProjectionRequest {
  return {
    deferralDocuments: [...DEFERRAL_DOCUMENTS].sort(),
    requiredDocuments: [
      ...new Set([...REQUIRED_DOCS.map((doc) => doc.file), BUILD_FILE, BUILD_AMENDMENTS_FILE]),
    ].sort(),
    suiteRows: [
      ...new Set([
        STATIC_SUITE_ROW,
        FEDERATION_SUITE_ROW,
        EVENTS_SUITE_ROW,
        ...M6_SUITE_ROWS,
        ...M7_SUITE_ROWS,
      ]),
    ].sort(),
    milestones: [
      ...new Set([
        MILESTONE_UNDER_GATE,
        FEDERATION_MILESTONE,
        EVENTS_MILESTONE,
        M6_MILESTONE,
        M7_MILESTONE,
      ]),
    ].sort(),
    stylesheets: [
      ...new Set(
        THEME_TOKEN_STYLESHEETS.flatMap((sheet) => sheet.files).filter((file) =>
          file.startsWith(`${AI_DOCS_DIR}/`),
        ),
      ),
    ].sort(),
  };
}

/**
 * Writes the committed reading of `ai-docs/` that the gates run on.
 *
 * RUN IT WHEN A DOCUMENT MOVES, WITH `pnpm gates:projection`, AND COMMIT THE RESULT. It needs
 * `ai-docs/` on the machine, so it is the maintainer's step and nobody else's; every other
 * checkout reads what it wrote. `build-manifest` re-runs the same projection wherever the
 * documents are and fails when the committed file no longer agrees with them, so forgetting this
 * step is a red build rather than a stale reading nobody notices.
 *
 * IT REFUSES TO WRITE FROM A TREE WITH NO DOCUMENTS, which would otherwise produce a valid
 * artefact recording that every document is missing, sign it, and pass its own integrity check on
 * every clone. That is the exact shape of an absence reading as coverage.
 *
 * THE `gates:projection` SCRIPT RUNS PRETTIER OVER WHAT THIS WRITES, and that is why the step is a
 * script rather than this file alone. The artefact is inside the format allowlist, so the `format`
 * gate holds it to prettier's shape like every other committed JSON; matching prettier's line
 * filling by hand here would be a second implementation of it, and the first thing to drift.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_DOCS_DIR, aiDocsPresent } from './lib/ai-docs.js';
import { projectionRequest } from './lib/projection-request.js';
import { PROJECTION_FILE, projectFromDisk, writeProjection } from './lib/projection.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

if (!aiDocsPresent(repoRoot)) {
  process.stderr.write(
    `${AI_DOCS_DIR}/ is not in this checkout, so there is nothing to project. This step runs on ` +
      `the tree that has the private documents; every other checkout reads the committed ` +
      `${PROJECTION_FILE}.\n`,
  );
  process.exitCode = 1;
} else {
  const projection = projectFromDisk(repoRoot, projectionRequest());
  writeProjection(repoRoot, projection);
  process.stdout.write(`${PROJECTION_FILE} written, integrity ${projection.integrity}\n`);
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_FILE, BUILD_LINE_COUNT, BUILD_TASK_COUNT } from '../config.js';
import { checkBuildManifest } from '../lib/build-manifest.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Verifies that `ai-docs/BUILD.md` still means what its CONTENTS ranges say.
 *
 * Runs before every other gate. A shifted BUILD.md means the session read the wrong task,
 * which makes the rest of the run a report on the wrong work.
 */
export const buildManifestGate: Gate = {
  id: 'build-manifest',
  title: 'BUILD.md line addressing',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const path = join(context.repoRoot, BUILD_FILE);

    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      findings.push({ level: 'error', message: `${BUILD_FILE} could not be read` });
      return Promise.resolve({
        id: buildManifestGate.id,
        title: buildManifestGate.title,
        status: 'fail',
        findings,
      });
    }

    const issues = checkBuildManifest(text, BUILD_LINE_COUNT, BUILD_TASK_COUNT);

    for (const issue of issues) {
      findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
    }

    if (issues.length === 0) {
      findings.push({
        level: 'info',
        message: `${BUILD_FILE} intact: ${String(BUILD_LINE_COUNT)} lines, ${String(BUILD_TASK_COUNT)} tasks, every range on its own heading`,
      });
    }

    return Promise.resolve({
      id: buildManifestGate.id,
      title: buildManifestGate.title,
      status: issues.length === 0 ? 'pass' : 'fail',
      findings,
    });
  },
};

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_FILE,
  BUILD_LINE_COUNT,
  BUILD_TASK_COUNT,
  REQUIRED_DOC_MIN_BYTES,
  REQUIRED_DOCS,
} from '../config.js';
import { aiDocsAbsentMessage, aiDocsPresent } from '../lib/ai-docs.js';
import { checkBuildManifest, checkRequiredDocs } from '../lib/build-manifest.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Verifies that the documents the project is written against are there, and that
 * `ai-docs/BUILD.md` still means what its CONTENTS ranges say.
 *
 * Runs before every other gate, and in that order within itself: a shifted BUILD.md means the
 * session read the wrong task, and a missing SPEC.md means it had nothing to read at all.
 * Either makes the rest of the run a report on the wrong work.
 */
export const buildManifestGate: Gate = {
  id: 'build-manifest',
  title: 'Project documents and BUILD.md line addressing',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let failed = false;

    if (!aiDocsPresent(context.repoRoot)) {
      return Promise.resolve({
        id: buildManifestGate.id,
        title: buildManifestGate.title,
        status: 'skip',
        skipReason: 'ai-docs-absent',
        findings: [
          {
            level: 'warning',
            message: aiDocsAbsentMessage(
              buildManifestGate.title,
              REQUIRED_DOCS.map((doc) => doc.file),
            ),
          },
        ],
      });
    }

    const docs = checkRequiredDocs(REQUIRED_DOCS, REQUIRED_DOC_MIN_BYTES, (file) => {
      try {
        return statSync(join(context.repoRoot, file)).size;
      } catch {
        return undefined;
      }
    });

    for (const doc of docs) {
      if (doc.presence === 'missing') {
        failed = true;
        findings.push({
          level: 'error',
          message: `${doc.file} is missing. It is ${doc.purpose}, and it is outside the repository, so nothing restores it from a clone`,
        });
        continue;
      }

      if (doc.presence === 'empty') {
        failed = true;
        findings.push({
          level: 'error',
          message: `${doc.file} holds ${String(doc.bytes)} bytes, under the ${String(REQUIRED_DOC_MIN_BYTES)} a real document holds. A placeholder passes a presence check and carries nothing`,
        });
      }
    }

    if (!failed) {
      findings.push({
        level: 'info',
        message: `${String(docs.length)} project document(s) present: ${docs.map((doc) => doc.file).join(', ')}`,
      });
    }

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
      failed = true;
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
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_ROOTS } from '../config.js';
import {
  auditFixtures,
  FIXTURE_ALLOWED_LICENSES,
  type FixtureFinding,
  type FixtureManifestEntry,
} from '../lib/fixtures.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/** A vendored corpus: a documents directory, a manifest and a NOTICE beside them. */
export interface FixtureRoot {
  /** Repository relative directory holding `manifest.json`, `NOTICE` and `documents/`. */
  readonly directory: string;
  /** Task that owns the corpus, printed when it is not there yet. */
  readonly producedBy: string;
}

function readManifest(path: string): FixtureManifestEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const documents = (parsed as { documents?: unknown }).documents;
  return Array.isArray(documents) ? (documents as FixtureManifestEntry[]) : null;
}

/**
 * Checks vendored fixtures against zone 3 of SPEC 0.
 *
 * Separate from the dependency license gate on purpose. That one asks what a consumer of a
 * published package becomes bound by; this one asks whether a document sitting in the
 * repository may be kept, modified and redistributed with it. Same subject, different
 * question, different allowed set, so folding them together would blur both.
 */
export const fixtureLicensesGate: Gate = {
  id: 'fixture-licenses',
  title: 'Licenses, vendored fixtures',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let checked = 0;
    let failed = false;
    let anyRoot = false;

    for (const root of FIXTURE_ROOTS) {
      const base = join(context.repoRoot, root.directory);
      const documentsDirectory = join(base, 'documents');

      let presentFiles: string[];
      try {
        presentFiles = readdirSync(documentsDirectory).sort();
      } catch {
        findings.push({
          level: 'info',
          message: `SKIP ${root.directory}: no documents directory yet (produced by ${root.producedBy})`,
        });
        continue;
      }

      anyRoot = true;

      const entries = readManifest(join(base, 'manifest.json'));
      if (entries === null) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${root.directory}: manifest.json is missing or does not hold a documents array`,
        });
        continue;
      }

      let notice: string;
      try {
        notice = readFileSync(join(base, 'NOTICE'), 'utf8');
      } catch {
        failed = true;
        findings.push({
          level: 'error',
          message: `${root.directory}: no NOTICE beside the documents, so attribution would not travel with them`,
        });
        notice = '';
      }

      const digests: Record<string, string> = {};
      for (const file of presentFiles) {
        digests[file] = createHash('sha256')
          .update(readFileSync(join(documentsDirectory, file), 'utf8'), 'utf8')
          .digest('hex');
      }

      const audited = auditFixtures({ presentFiles, entries, notice, digests });
      checked += presentFiles.length;

      for (const finding of audited) {
        if (finding.level === 'error') failed = true;
        findings.push({
          level: finding.level,
          message: `${root.directory}/documents/${finding.file}: ${finding.reason}`,
        });
      }

      const licenses = [...new Set(entries.map((entry: FixtureManifestEntry) => entry.license))]
        .sort()
        .join(', ');
      findings.push({
        level: 'info',
        message: `${root.directory}: ${String(presentFiles.length)} document(s), licensed ${licenses}`,
      });
    }

    if (!anyRoot) {
      return Promise.resolve({
        id: fixtureLicensesGate.id,
        title: fixtureLicensesGate.title,
        status: 'skip',
        findings,
      });
    }

    if (!failed) {
      findings.push({
        level: 'info',
        message: `${String(checked)} fixture(s) attributed and inside ${FIXTURE_ALLOWED_LICENSES.join(', ')}`,
      });
    }

    return Promise.resolve({
      id: fixtureLicensesGate.id,
      title: fixtureLicensesGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};

export type { FixtureFinding };

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

/**
 * A root of vendored material: the files, a manifest and a NOTICE beside them.
 *
 * One shape covers zone 3 and zone 4. What differs is the directory, the key the manifest
 * lists its entries under, the allowed licences, and whether a licence text sits beside the
 * files and has to be read. Nothing else differs, which is the reason this is a second
 * instance rather than a second gate.
 */
export interface FixtureRoot {
  /** Repository relative directory holding the manifest and the notice. */
  readonly directory: string;
  /** Task that owns the material, printed when it is not there yet. */
  readonly producedBy: string;
  /** Subdirectory holding the files themselves, empty when they sit in `directory`. */
  readonly filesDirectory: string;
  /** Name of the notice file beside them. */
  readonly noticeFile: string;
  /** Key the manifest lists its entries under. */
  readonly manifestKey: string;
  /** Licences this material may carry. */
  readonly allowedLicenses: readonly string[];
  /** Extensions counted as material; everything else in the directory is supporting matter. */
  readonly extensions: readonly string[];
  /** Zone 4: read the licence text beside the files and check the reserved font name. */
  readonly readsLicenseText: boolean;
  /** What this root holds, for the summary line. */
  readonly label: string;
}

function readManifest(path: string, key: string): FixtureManifestEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const entries = (parsed as Record<string, unknown>)[key];
  return Array.isArray(entries) ? (entries as FixtureManifestEntry[]) : null;
}

/**
 * Checks vendored material against zone 3 and zone 4 of SPEC 0.
 *
 * Separate from the dependency license gate on purpose. That one asks what a consumer of a
 * published package becomes bound by; this one asks whether a file sitting in the repository
 * may be kept, modified and redistributed with it. Same subject, different question, different
 * allowed set, so folding them together would blur both.
 *
 * DIGESTS ARE TAKEN OVER RAW BYTES. A font is not text, and reading one as UTF-8 to hash it
 * would replace every byte sequence that is not valid UTF-8 before the hash ever saw it, which
 * is a digest of something other than the file.
 */
export const fixtureLicensesGate: Gate = {
  id: 'fixture-licenses',
  title: 'Licenses, vendored fixtures and shipped assets',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let checked = 0;
    let failed = false;
    let anyRoot = false;

    for (const root of FIXTURE_ROOTS) {
      const base = join(context.repoRoot, root.directory);
      const filesDirectory = root.filesDirectory === '' ? base : join(base, root.filesDirectory);

      let presentFiles: string[];
      try {
        presentFiles = readdirSync(filesDirectory)
          .filter((file) => root.extensions.some((extension) => file.endsWith(extension)))
          .sort();
      } catch {
        findings.push({
          level: 'info',
          message: `SKIP ${root.directory}: not there yet (produced by ${root.producedBy})`,
        });
        continue;
      }

      if (presentFiles.length === 0) {
        findings.push({
          level: 'info',
          message: `SKIP ${root.directory}: no ${root.extensions.join(', ')} file yet (produced by ${root.producedBy})`,
        });
        continue;
      }

      anyRoot = true;

      const entries = readManifest(join(base, 'manifest.json'), root.manifestKey);
      if (entries === null) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${root.directory}: manifest.json is missing or does not hold a ${root.manifestKey} array`,
        });
        continue;
      }

      let notice: string;
      try {
        notice = readFileSync(join(base, root.noticeFile), 'utf8');
      } catch {
        failed = true;
        findings.push({
          level: 'error',
          message: `${root.directory}: no ${root.noticeFile} beside the files, so attribution would not travel with them`,
        });
        notice = '';
      }

      const digests: Record<string, string> = {};
      const sizes: Record<string, number> = {};
      for (const file of presentFiles) {
        const content = readFileSync(join(filesDirectory, file));
        digests[file] = createHash('sha256').update(content).digest('hex');
        sizes[file] = content.byteLength;
      }

      let licenseTexts: Record<string, string> | undefined;
      if (root.readsLicenseText) {
        licenseTexts = {};
        for (const entry of entries) {
          const name = entry.licenseTextFile ?? '';
          if (name === '' || name in licenseTexts) continue;
          try {
            licenseTexts[name] = readFileSync(join(filesDirectory, name), 'utf8');
          } catch {
            // Left absent on purpose. The audit reports a named text that is not there, which
            // is a better message than a read error from the gate.
          }
        }
      }

      const audited = auditFixtures({
        presentFiles,
        entries,
        notice,
        digests,
        sizes,
        allowedLicenses: root.allowedLicenses,
        ...(licenseTexts === undefined ? {} : { licenseTexts }),
      });
      checked += presentFiles.length;

      for (const finding of audited) {
        if (finding.level === 'error') failed = true;
        const where =
          root.filesDirectory === ''
            ? `${root.directory}/${finding.file}`
            : `${root.directory}/${root.filesDirectory}/${finding.file}`;
        findings.push({ level: finding.level, message: `${where}: ${finding.reason}` });
      }

      const licenses = [...new Set(entries.map((entry: FixtureManifestEntry) => entry.license))]
        .sort()
        .join(', ');
      findings.push({
        level: 'info',
        message: `${root.directory}: ${String(presentFiles.length)} ${root.label}, licensed ${licenses}`,
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
        message: `${String(checked)} vendored file(s) attributed, digests intact, licences inside their zone; zone 3 is ${FIXTURE_ALLOWED_LICENSES.join(', ')}`,
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

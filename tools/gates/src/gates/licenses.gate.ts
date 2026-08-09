import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LICENSE_ATTESTATIONS } from '../config.js';
import { runCommand } from '../lib/exec.js';
import {
  ALLOWED_LICENSES,
  checkLicenseAttestation,
  detectLicenseFromText,
  evaluateDevelopmentTree,
  evaluateProductionTree,
  findStaleAttestations,
  flattenLicenseReport,
  hashLicenseText,
  isLicenseAllowed,
  isUnidentifiedLicense,
  packageKey,
  type LicenseFinding,
  type LicensedPackage,
  type PnpmLicenseReport,
} from '../lib/licenses.js';
import { readWorkspaceManifests, resolveShippedPackages } from '../lib/workspace.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

const LICENSE_FILE_NAMES: readonly string[] = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
];

/**
 * Parses `pnpm licenses list --json`. An empty tree is reported as plain text, not JSON.
 *
 * @param stdout - Raw command output
 * @returns Parsed report, or an empty report when the tree holds no third party packages
 */
function parseReport(stdout: string): PnpmLicenseReport {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return {};
  return JSON.parse(trimmed) as PnpmLicenseReport;
}

/**
 * Replaces an unidentifiable manifest license with one read from the license file, and
 * checks that reading against the committed record of it.
 *
 * @param entry - Package as reported by pnpm
 * @param usedKeys - Collects the packages that needed a reading, so stale records show up
 * @returns The package with its license resolved, plus a finding when the reading is
 *          unrecorded or no longer matches the text
 */
function resolveLicense(
  entry: LicensedPackage,
  usedKeys: Set<string>,
): { readonly entry: LicensedPackage; readonly finding: LicenseFinding | null } {
  if (!isUnidentifiedLicense(entry.license)) return { entry, finding: null };

  for (const path of entry.paths) {
    for (const fileName of LICENSE_FILE_NAMES) {
      let text: string;
      try {
        text = readFileSync(join(path, fileName), 'utf8');
      } catch {
        continue;
      }

      const detected = detectLicenseFromText(text);
      if (detected === null) continue;

      const resolution = { file: fileName, sha256: hashLicenseText(text) };
      usedKeys.add(packageKey(entry));

      return {
        entry: { ...entry, license: detected, resolvedFrom: resolution },
        finding: checkLicenseAttestation(entry, resolution, detected, LICENSE_ATTESTATIONS),
      };
    }
  }

  return { entry, finding: null };
}

function describe(finding: LicenseFinding): string {
  const version = finding.versions.length > 0 ? `@${finding.versions.join(',')}` : '';
  return `${finding.packageName}${version}: ${finding.license} - ${finding.reason}`;
}

function describePackage(entry: LicensedPackage): string {
  const source =
    entry.resolvedFrom === undefined
      ? ''
      : ` (read from ${entry.resolvedFrom.file}, sha256 ${entry.resolvedFrom.sha256.slice(0, 12)})`;
  return `${entry.name}@${entry.versions.join(',')}: ${entry.license}${source}`;
}

/**
 * Checks the whole dependency tree against the two zone license policy of SPEC 0.
 *
 * The production zone is the dependency closure of what is published: every package that
 * ships as its own tarball, plus every private package bundled into one. It is not the
 * workspace production tree, which both misses bundled internals and would count nothing
 * a consumer ever installs.
 */
export const licensesGate: Gate = {
  id: 'licenses',
  title: 'Licenses, published closure and development tree',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const fail = (message: string): Promise<GateResult> => {
      findings.push({ level: 'error', message });
      return Promise.resolve({
        id: licensesGate.id,
        title: licensesGate.title,
        status: 'fail',
        findings,
      });
    };

    const { published, bundled, shipped } = resolveShippedPackages(
      readWorkspaceManifests(context.repoRoot),
    );

    if (shipped.length === 0) {
      return fail('no publishable workspace package found; the production zone would be empty');
    }

    const full = runCommand('pnpm', ['licenses', 'list', '--json'], context.repoRoot);
    if (!full.ok) {
      return fail(`pnpm licenses list failed: ${full.stderr.trim()}`);
    }

    const production = runCommand(
      'pnpm',
      ['licenses', 'list', '--json', '--prod', ...shipped.flatMap((name) => ['--filter', name])],
      context.repoRoot,
    );
    if (!production.ok) {
      return fail(
        `pnpm licenses list for the published closure failed: ${production.stderr.trim()}`,
      );
    }

    const usedKeys = new Set<string>();
    const attestationFindings: LicenseFinding[] = [];

    const resolve = (entry: LicensedPackage): LicensedPackage => {
      const resolved = resolveLicense(entry, usedKeys);
      if (resolved.finding !== null) attestationFindings.push(resolved.finding);
      return resolved.entry;
    };

    const productionPackages = flattenLicenseReport(parseReport(production.stdout)).map(resolve);
    const productionKeys = new Set(productionPackages.map(packageKey));
    const developmentPackages = flattenLicenseReport(parseReport(full.stdout))
      .filter((entry) => !productionKeys.has(packageKey(entry)))
      .map(resolve);

    findings.push({
      level: 'info',
      message: `production zone: closure of ${published.join(', ')}${bundled.length > 0 ? `, bundling ${bundled.join(', ')}` : ''}`,
    });

    for (const finding of attestationFindings) {
      findings.push({ level: finding.level, message: `license reading: ${describe(finding)}` });
    }

    for (const finding of findStaleAttestations(LICENSE_ATTESTATIONS, usedKeys)) {
      findings.push({ level: finding.level, message: `license reading: ${describe(finding)}` });
    }

    for (const finding of evaluateProductionTree(productionPackages)) {
      findings.push({ level: 'error', message: `production zone: ${describe(finding)}` });
    }

    const developmentFindings = evaluateDevelopmentTree(developmentPackages);
    for (const finding of developmentFindings) {
      findings.push({ level: finding.level, message: `development zone: ${describe(finding)}` });
    }

    const permissiveOutsideAllowlist = developmentPackages.filter(
      (entry) =>
        !isLicenseAllowed(entry.license) &&
        !developmentFindings.some((finding) => finding.packageName === entry.name),
    );

    for (const entry of permissiveOutsideAllowlist) {
      findings.push({
        level: 'info',
        message: `development zone: ${describePackage(entry)} - permissive, outside the production allowlist`,
      });
    }

    findings.push({
      level: 'info',
      message: `checked ${String(productionPackages.length)} published and ${String(developmentPackages.length)} development packages against ${ALLOWED_LICENSES.join(', ')}`,
    });

    const hasError = findings.some((finding) => finding.level === 'error');

    return Promise.resolve({
      id: licensesGate.id,
      title: licensesGate.title,
      status: hasError ? 'fail' : 'pass',
      findings,
    });
  },
};

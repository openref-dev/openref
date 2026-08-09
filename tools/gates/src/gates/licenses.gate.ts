import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../lib/exec.js';
import {
  ALLOWED_LICENSES,
  detectLicenseFromText,
  evaluateDevelopmentTree,
  evaluateProductionTree,
  flattenLicenseReport,
  isLicenseAllowed,
  isUnidentifiedLicense,
  type LicenseFinding,
  type LicensedPackage,
  type PnpmLicenseReport,
} from '../lib/licenses.js';
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
 * Replaces an unidentifiable manifest license with one detected from the license file.
 *
 * @param entry - Package as reported by pnpm
 * @returns The same package, with the license resolved when the file text is recognised
 */
function resolveLicense(entry: LicensedPackage): LicensedPackage {
  if (!isUnidentifiedLicense(entry.license)) return entry;

  for (const path of entry.paths) {
    for (const fileName of LICENSE_FILE_NAMES) {
      let text: string;
      try {
        text = readFileSync(join(path, fileName), 'utf8');
      } catch {
        continue;
      }

      const detected = detectLicenseFromText(text);
      if (detected !== null) {
        return { ...entry, license: `${detected} (detected from ${fileName})` };
      }
    }
  }

  return entry;
}

function describe(finding: LicenseFinding): string {
  return `${finding.packageName}@${finding.versions.join(',')}: ${finding.license} - ${finding.reason}`;
}

/**
 * Scans the whole dependency tree, production and development, against the license policy.
 */
export const licensesGate: Gate = {
  id: 'licenses',
  title: 'Licenses, whole dependency tree',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];

    const full = runCommand('pnpm', ['licenses', 'list', '--json'], context.repoRoot);
    if (!full.ok) {
      findings.push({
        level: 'error',
        message: `pnpm licenses list failed: ${full.stderr.trim()}`,
      });
      return Promise.resolve({
        id: licensesGate.id,
        title: licensesGate.title,
        status: 'fail',
        findings,
      });
    }

    const production = runCommand(
      'pnpm',
      ['licenses', 'list', '--json', '--prod'],
      context.repoRoot,
    );

    const allPackages = flattenLicenseReport(parseReport(full.stdout)).map(resolveLicense);
    const productionPackages = flattenLicenseReport(parseReport(production.stdout)).map(
      resolveLicense,
    );

    const productionKeys = new Set(
      productionPackages.map((entry) => `${entry.name}@${entry.versions.join(',')}`),
    );
    const developmentPackages = allPackages.filter(
      (entry) => !productionKeys.has(`${entry.name}@${entry.versions.join(',')}`),
    );

    const productionFindings = evaluateProductionTree(productionPackages);
    const developmentFindings = evaluateDevelopmentTree(developmentPackages);

    for (const finding of productionFindings) {
      findings.push({ level: 'error', message: `production tree: ${describe(finding)}` });
    }

    for (const finding of developmentFindings) {
      findings.push({ level: finding.level, message: `development tree: ${describe(finding)}` });
    }

    const permissiveOutsideAllowlist = developmentPackages.filter(
      (entry) =>
        !isLicenseAllowed(entry.license) &&
        !developmentFindings.some((finding) => finding.packageName === entry.name),
    );

    for (const entry of permissiveOutsideAllowlist) {
      findings.push({
        level: 'info',
        message: `development tree: ${entry.name}@${entry.versions.join(',')}: ${entry.license} - permissive, outside the production allowlist`,
      });
    }

    findings.push({
      level: 'info',
      message: `checked ${String(productionPackages.length)} production and ${String(developmentPackages.length)} development packages against ${ALLOWED_LICENSES.join(', ')}`,
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

/**
 * License identification and policy evaluation.
 *
 * Two scopes, both enforced, as stated in SPEC 0:
 *
 * - production zone, the dependency closure of what is actually published: every license
 *   must be one of {@link ALLOWED_LICENSES}
 * - development zone: strong copyleft, source available and unidentifiable licenses are
 *   rejected; weak per file copyleft is reported as a warning because a build time tool
 *   that is never redistributed carries no obligation into the published artifacts
 *
 * There is no per package exception list. Adding one would turn this gate into a switch.
 * A data-only license carries a condition rather than an exception: the identifier is on
 * the allowlist for every package, and every package it admits has to be read first.
 *
 * A license read out of a LICENSE file rather than a manifest is recorded with the hash of
 * the text it was read from, so the reading has to be redone when the text changes rather
 * than surviving as a stale assumption.
 */

import { createHash } from 'node:crypto';

/**
 * The only licenses allowed anywhere in the production dependency tree.
 *
 * SPEC 0 states the reason each one is here. The last three were added on 2026-08-09:
 * MIT-0 is MIT without the attribution clause and so strictly more permissive than a
 * license already on the list; BlueOak-1.0.0 is permissive with an explicit patent grant,
 * which is more than MIT offers, and the development zone already treated it as permissive.
 * CC0-1.0 is different in kind and carries the extra condition below.
 */
export const ALLOWED_LICENSES: readonly string[] = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'MIT-0',
  'BlueOak-1.0.0',
  'CC0-1.0',
];

/**
 * Licenses that are only allowed for a package made of data.
 *
 * CC0-1.0 is not OSI approved and explicitly withholds patent rights. It is accepted for
 * reference data, where the withheld grant covers nothing that could be asserted, and not
 * as a general permission. A package admitted by one of these licenses therefore has to
 * carry a recorded reading of its contents, keyed by version, so a new version and any new
 * package under the same license stop the gate until someone looks inside.
 */
export const DATA_ONLY_LICENSES: readonly string[] = ['CC0-1.0'];

/** The allowlist with the data-only licenses removed, used to tell the two cases apart. */
const UNCONDITIONAL_LICENSES: readonly string[] = ALLOWED_LICENSES.filter(
  (id) => !DATA_ONLY_LICENSES.includes(id),
);

/** Reciprocal licenses that place obligations on derived works as a whole. */
export const STRONG_COPYLEFT_PATTERNS: readonly RegExp[] = [
  /^AGPL/i,
  /^GPL/i,
  /^LGPL/i,
  /^OSL/i,
  /^CPAL/i,
  /^SSPL/i,
  /^RPL/i,
  /^QPL/i,
  /^Sleepycat/i,
];

/** Reciprocal licenses whose obligations attach per file rather than to the whole work. */
export const WEAK_COPYLEFT_PATTERNS: readonly RegExp[] = [
  /^MPL/i,
  /^EPL/i,
  /^CDDL/i,
  /^EUPL/i,
  /^Ms-RL/i,
];

/** Licenses that are not open source, or that restrict the field of use. */
export const SOURCE_AVAILABLE_PATTERNS: readonly RegExp[] = [
  /^BUSL/i,
  /^BSL/i,
  /^Elastic/i,
  /^Commons-Clause/i,
  /^CC-BY-NC/i,
  /^CC-BY-ND/i,
  /^Prosperity/i,
  /^PolyForm/i,
];

/** Markers that mean the license could not be identified from the manifest. */
const UNIDENTIFIED_MARKERS: readonly RegExp[] = [
  /^unknown$/i,
  /^unlicensed$/i,
  /^see\s+license/i,
  /^custom/i,
  /^$/,
];

/**
 * Where a license came from, when it did not come from the manifest.
 */
export interface LicenseResolution {
  readonly file: string;
  readonly sha256: string;
}

/**
 * One package as reported by `pnpm licenses list --json`.
 */
export interface LicensedPackage {
  readonly name: string;
  readonly versions: readonly string[];
  readonly license: string;
  readonly paths: readonly string[];
  /** Present when the license was read from a file rather than declared in the manifest. */
  readonly resolvedFrom?: LicenseResolution;
}

/**
 * The identity a license attestation is keyed by.
 *
 * The version is part of the key on purpose. An attestation records the text that was
 * read once, at one version, and says nothing about any other version.
 *
 * @param entry - Package as reported by pnpm
 * @returns `name@version[,version]`
 */
export function packageKey(entry: Pick<LicensedPackage, 'name' | 'versions'>): string {
  return `${entry.name}@${[...entry.versions].sort().join(',')}`;
}

/**
 * Hashes the exact bytes of a license file as they were read.
 *
 * @param text - Contents of the license file
 * @returns Lowercase hex SHA-256
 */
export function hashLicenseText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Raw shape of `pnpm licenses list --json`: license identifier to packages.
 */
export type PnpmLicenseReport = Record<string, readonly LicensedPackage[]>;

/**
 * A package that violates the license policy.
 */
export interface LicenseFinding {
  readonly level: 'error' | 'warning';
  readonly packageName: string;
  readonly versions: readonly string[];
  readonly license: string;
  readonly reason: string;
}

/**
 * Flattens the pnpm report into a stable, deduplicated list ordered by package name.
 *
 * @param report - Parsed output of `pnpm licenses list --json`
 * @returns Packages sorted by name, then by license identifier
 */
export function flattenLicenseReport(report: PnpmLicenseReport): LicensedPackage[] {
  const flat: LicensedPackage[] = [];

  for (const [license, packages] of Object.entries(report)) {
    for (const entry of packages) {
      flat.push({
        name: entry.name,
        versions: [...entry.versions].sort(),
        license: entry.license === '' ? license : entry.license,
        paths: [...entry.paths].sort(),
      });
    }
  }

  return flat.sort((a, b) => a.name.localeCompare(b.name) || a.license.localeCompare(b.license));
}

/**
 * Splits an SPDX expression into its individual license identifiers.
 *
 * Nested expressions are flattened; `WITH` exception clauses keep only the base license.
 *
 * @param expression - SPDX expression, for example `(MIT OR Apache-2.0)`
 * @returns Individual identifiers, upper bound of what the expression can mean
 */
export function splitLicenseExpression(expression: string): string[] {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((part) => part.trim().split(/\s+WITH\s+/i)[0] ?? '')
    .map((part) => part.trim().replace(/\+$/, ''))
    .filter((part) => part.length > 0);
}

/**
 * Reports whether the license could not be identified at all.
 *
 * @param expression - Declared license expression
 * @returns True when the manifest gives no usable identifier
 */
export function isUnidentifiedLicense(expression: string): boolean {
  const trimmed = expression.trim();
  return UNIDENTIFIED_MARKERS.some((marker) => marker.test(trimmed));
}

/**
 * Reports whether an SPDX expression satisfies the production allowlist.
 *
 * An `OR` expression passes when any branch is allowed. An `AND` expression passes only
 * when every identifier is allowed.
 *
 * @param expression - Declared license expression
 * @param allowlist - Identifiers to accept, the full allowlist by default
 * @returns True when the expression is acceptable in the production tree
 */
export function isLicenseAllowed(
  expression: string,
  allowlist: readonly string[] = ALLOWED_LICENSES,
): boolean {
  if (isUnidentifiedLicense(expression)) return false;

  const allowed = new Set(allowlist.map((id) => id.toLowerCase()));
  const stripped = expression.replace(/[()]/g, ' ').trim();

  const orBranches = stripped.split(/\s+OR\s+/i);
  if (orBranches.length > 1) {
    return orBranches.some((branch) => isLicenseAllowed(branch, allowlist));
  }

  const andParts = splitLicenseExpression(stripped);
  if (andParts.length === 0) return false;

  return andParts.every((part) => allowed.has(part.toLowerCase()));
}

/**
 * Reports whether a package passes only because of a data-only license.
 *
 * A package offering an unconditional branch, `(CC0-1.0 OR MIT)`, needs nothing extra: the
 * permissive branch can be chosen. A package whose only route through the allowlist runs
 * through {@link DATA_ONLY_LICENSES} has to be attested.
 *
 * @param expression - Declared license expression
 * @returns True when the expression needs a data-only attestation to be accepted
 */
export function requiresDataOnlyAttestation(expression: string): boolean {
  if (!isLicenseAllowed(expression)) return false;
  return !isLicenseAllowed(expression, UNCONDITIONAL_LICENSES);
}

/**
 * Classifies a license expression against the reciprocal and field of use families.
 *
 * A dual licensed package that offers an allowed branch is not classified, because the
 * permissive branch can always be chosen.
 *
 * @param expression - Declared license expression
 * @returns The family the expression falls into, or `null` when it falls into none
 */
export function classifyRestrictiveFamily(
  expression: string,
): 'strong-copyleft' | 'weak-copyleft' | 'source-available' | null {
  if (isLicenseAllowed(expression)) return null;

  const identifiers = splitLicenseExpression(expression);
  const matches = (patterns: readonly RegExp[]): boolean =>
    identifiers.some((id) => patterns.some((pattern) => pattern.test(id)));

  if (matches(SOURCE_AVAILABLE_PATTERNS)) return 'source-available';
  if (matches(STRONG_COPYLEFT_PATTERNS)) return 'strong-copyleft';
  if (matches(WEAK_COPYLEFT_PATTERNS)) return 'weak-copyleft';

  return null;
}

/**
 * A recorded reading of what a package under a data-only license actually contains.
 *
 * This is not an exception either. The license set already admits CC0-1.0; what the record
 * carries is the condition SPEC 0 attaches to it, that the package is reference data rather
 * than an implementation of something patentable. The version is part of the key, so the
 * record expires by itself when the package moves.
 */
export interface DataOnlyAttestation {
  /** `name@version`, as produced by {@link packageKey}. */
  readonly package: string;
  /** SPDX identifier the record was taken for. */
  readonly license: string;
  /** What the package holds, and why the withheld patent grant covers nothing in it. */
  readonly rationale: string;
}

/**
 * Applies the production policy: the allowlist, with no exceptions.
 *
 * A package admitted only by a data-only license also has to carry a committed record that
 * someone read its contents. An unrecorded one fails rather than passing on the strength of
 * the identifier alone.
 *
 * @param packages - Packages reachable from the production dependency tree
 * @param attestations - Committed data-only records, from `config.ts`
 * @param usedKeys - Collects the packages that needed a record, so stale ones show up
 * @returns One error finding per package outside the allowlist or lacking a required record
 */
export function evaluateProductionTree(
  packages: readonly LicensedPackage[],
  attestations: readonly DataOnlyAttestation[] = [],
  usedKeys: Set<string> = new Set<string>(),
): LicenseFinding[] {
  const findings: LicenseFinding[] = [];

  for (const entry of packages) {
    if (isLicenseAllowed(entry.license)) {
      if (!requiresDataOnlyAttestation(entry.license)) continue;

      const key = packageKey(entry);
      usedKeys.add(key);
      const attestation = attestations.find((candidate) => candidate.package === key);

      if (attestation === undefined) {
        findings.push({
          level: 'error',
          packageName: entry.name,
          versions: entry.versions,
          license: entry.license,
          reason: `${entry.license} is accepted only for a package made of data. Read what this package ships, then record it as { package: '${key}', license: '${entry.license}', rationale: '...' } in DATA_ONLY_ATTESTATIONS`,
        });
        continue;
      }

      if (attestation.license !== entry.license) {
        findings.push({
          level: 'error',
          packageName: entry.name,
          versions: entry.versions,
          license: entry.license,
          reason: `the recorded data-only reading was taken for ${attestation.license}, the package now declares ${entry.license}`,
        });
      }

      continue;
    }

    const reason = isUnidentifiedLicense(entry.license)
      ? 'license could not be identified from the manifest or the license file'
      : `license is outside the allowlist (${ALLOWED_LICENSES.join(', ')})`;

    findings.push({
      level: 'error',
      packageName: entry.name,
      versions: entry.versions,
      license: entry.license,
      reason,
    });
  }

  return findings;
}

/**
 * Finds data-only records that no longer correspond to anything in the published closure.
 *
 * @param attestations - The committed records
 * @param usedKeys - Package keys that actually needed a record in this run
 * @returns One warning per record that went unused
 */
export function findStaleDataOnlyAttestations(
  attestations: readonly DataOnlyAttestation[],
  usedKeys: ReadonlySet<string>,
): LicenseFinding[] {
  return attestations
    .filter((attestation) => !usedKeys.has(attestation.package))
    .map((attestation) => ({
      level: 'warning' as const,
      packageName: attestation.package,
      versions: [],
      license: attestation.license,
      reason: 'recorded data-only reading matches nothing in the published closure; remove it',
    }));
}

/**
 * Checks that the tools which must never reach a consumer did not.
 *
 * TWO DIRECTIONS, AND THE SECOND IS WHAT KEEPS THIS HONEST. A named package inside the
 * published closure is an error, which is the check. A named package that the development tree
 * does not hold either is a warning, because then the entry names nothing this repository
 * installs and the check silently stops being able to fail.
 *
 * @param names - The committed list, with the reason each is named
 * @param production - Packages inside the published closure
 * @param development - Packages reachable only from the development tree
 * @returns One error per package that shipped, one warning per entry that matches nothing
 */
export function findNeverShippedViolations(
  names: readonly { readonly name: string; readonly reason: string }[],
  production: readonly LicensedPackage[],
  development: readonly LicensedPackage[],
): LicenseFinding[] {
  const findings: LicenseFinding[] = [];
  const inProduction = new Map(production.map((entry) => [entry.name, entry]));
  const inDevelopment = new Set(development.map((entry) => entry.name));

  for (const named of names) {
    const shipped = inProduction.get(named.name);

    if (shipped !== undefined) {
      findings.push({
        level: 'error',
        packageName: named.name,
        versions: [...shipped.versions],
        license: shipped.license,
        reason: `must never reach a consumer and is inside the published closure: ${named.reason}`,
      });
      continue;
    }

    if (!inDevelopment.has(named.name)) {
      findings.push({
        level: 'warning',
        packageName: named.name,
        versions: [],
        license: 'n/a',
        reason:
          'is named as never shipped and is in neither tree, so this entry can no longer fail; remove it',
      });
    }
  }

  return findings;
}

/**
 * Applies the development policy.
 *
 * Development tooling is never redistributed, so the question is narrower than the
 * production allowlist: does the license impose obligations on the whole work, or
 * restrict the field of use, or fail to identify itself at all.
 *
 * @param packages - Packages reachable only from the development dependency tree
 * @returns Errors for strong copyleft, source available and unidentified licenses;
 *          warnings for weak per file copyleft
 */
export function evaluateDevelopmentTree(packages: readonly LicensedPackage[]): LicenseFinding[] {
  const findings: LicenseFinding[] = [];

  for (const entry of packages) {
    if (isUnidentifiedLicense(entry.license)) {
      findings.push({
        level: 'error',
        packageName: entry.name,
        versions: entry.versions,
        license: entry.license,
        reason: 'license could not be identified from the manifest or the license file',
      });
      continue;
    }

    const family = classifyRestrictiveFamily(entry.license);
    if (family === 'source-available' || family === 'strong-copyleft') {
      findings.push({
        level: 'error',
        packageName: entry.name,
        versions: entry.versions,
        license: entry.license,
        reason: `${family} license is forbidden at any depth`,
      });
      continue;
    }

    if (family === 'weak-copyleft') {
      findings.push({
        level: 'warning',
        packageName: entry.name,
        versions: entry.versions,
        license: entry.license,
        reason: 'weak copyleft in a build time tool that is never redistributed',
      });
    }
  }

  return findings;
}

/**
 * Identifies a license from the text of a license file.
 *
 * Used when a manifest declares `SEE LICENSE IN ...` or omits the field entirely. Text
 * matching is deliberate: guessing from the package name would be worse than failing.
 *
 * @param text - Contents of a LICENSE file
 * @returns SPDX identifier, or `null` when the text is not recognised
 */
export function detectLicenseFromText(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (/Apache License,? Version 2\.0/i.test(normalized)) return 'Apache-2.0';
  if (/Blue Oak Model License/i.test(normalized)) return 'BlueOak-1.0.0';

  if (
    /Permission to use, copy, modify/i.test(normalized) &&
    /for any purpose with or without fee/i.test(normalized)
  ) {
    return 'ISC';
  }

  if (
    /Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(normalized)
  ) {
    return 'MIT';
  }

  if (/Redistribution and use in source and binary forms/i.test(normalized)) {
    return /Neither the name of/i.test(normalized) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }

  if (/PYTHON SOFTWARE FOUNDATION LICENSE/i.test(normalized)) return 'Python-2.0';

  return null;
}

/**
 * A recorded reading of a license out of a file, committed in `config.ts`.
 *
 * This is not an exception. It grants nothing and excuses nothing: it records what text
 * was read, at which version, and what it was read as. The hash is what makes the record
 * expire on its own.
 */
export interface LicenseAttestation {
  /** `name@version`, as produced by {@link packageKey}. */
  readonly package: string;
  /** SPDX identifier the text was read as. */
  readonly license: string;
  /** File the text was read from. */
  readonly file: string;
  /** SHA-256 of the exact text. */
  readonly sha256: string;
}

/**
 * Checks a license read out of a file against the committed record of that reading.
 *
 * @param entry - Package whose manifest gave no usable license
 * @param resolution - File and hash the license was read from
 * @param detected - SPDX identifier the text was recognised as
 * @param attestations - The committed records
 * @returns An error finding when the reading is unrecorded or no longer matches, else null
 */
export function checkLicenseAttestation(
  entry: Pick<LicensedPackage, 'name' | 'versions'>,
  resolution: LicenseResolution,
  detected: string,
  attestations: readonly LicenseAttestation[],
): LicenseFinding | null {
  const key = packageKey(entry);
  const attestation = attestations.find((candidate) => candidate.package === key);

  const finding = (reason: string): LicenseFinding => ({
    level: 'error',
    packageName: entry.name,
    versions: entry.versions,
    license: detected,
    reason,
  });

  if (attestation === undefined) {
    return finding(
      `license read from ${resolution.file} as ${detected} with no recorded reading. Record it as { package: '${key}', license: '${detected}', file: '${resolution.file}', sha256: '${resolution.sha256}' } after checking the text yourself`,
    );
  }

  if (attestation.file !== resolution.file) {
    return finding(
      `license read from ${resolution.file}, but the recorded reading was taken from ${attestation.file}`,
    );
  }

  if (attestation.sha256 !== resolution.sha256) {
    return finding(
      `the text of ${resolution.file} changed since it was read: recorded ${attestation.sha256}, found ${resolution.sha256}. Read it again rather than assuming it still says the same thing`,
    );
  }

  if (attestation.license !== detected) {
    return finding(
      `the recorded reading says ${attestation.license}, the text now reads as ${detected}`,
    );
  }

  return null;
}

/**
 * Finds recorded readings that no longer correspond to anything in the tree.
 *
 * A record that outlives its package is how a stale assumption starts, so it is reported
 * rather than ignored.
 *
 * @param attestations - The committed records
 * @param usedKeys - Package keys that actually needed a reading in this run
 * @returns One warning per record that went unused
 */
export function findStaleAttestations(
  attestations: readonly LicenseAttestation[],
  usedKeys: ReadonlySet<string>,
): LicenseFinding[] {
  return attestations
    .filter((attestation) => !usedKeys.has(attestation.package))
    .map((attestation) => ({
      level: 'warning' as const,
      packageName: attestation.package,
      versions: [],
      license: attestation.license,
      reason: 'recorded license reading matches nothing in the tree; remove it',
    }));
}

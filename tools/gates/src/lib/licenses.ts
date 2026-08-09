/**
 * License identification and policy evaluation.
 *
 * Two scopes, both enforced:
 *
 * - production tree: every license must be one of {@link ALLOWED_LICENSES}
 * - development tree: strong copyleft, source available and unidentifiable licenses are
 *   rejected; weak per file copyleft is reported as a warning because a build time tool
 *   that is never redistributed carries no obligation into the published artifacts
 *
 * There is no per package exception list. Adding one would turn this gate into a switch.
 */

/**
 * The only licenses allowed anywhere in the production dependency tree.
 */
export const ALLOWED_LICENSES: readonly string[] = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
];

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
 * One package as reported by `pnpm licenses list --json`.
 */
export interface LicensedPackage {
  readonly name: string;
  readonly versions: readonly string[];
  readonly license: string;
  readonly paths: readonly string[];
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
 * @returns True when the expression is acceptable in the production tree
 */
export function isLicenseAllowed(expression: string): boolean {
  if (isUnidentifiedLicense(expression)) return false;

  const allowed = new Set(ALLOWED_LICENSES.map((id) => id.toLowerCase()));
  const stripped = expression.replace(/[()]/g, ' ').trim();

  const orBranches = stripped.split(/\s+OR\s+/i);
  if (orBranches.length > 1) {
    return orBranches.some((branch) => isLicenseAllowed(branch));
  }

  const andParts = splitLicenseExpression(stripped);
  if (andParts.length === 0) return false;

  return andParts.every((part) => allowed.has(part.toLowerCase()));
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
 * Applies the production policy: the allowlist, with no exceptions.
 *
 * @param packages - Packages reachable from the production dependency tree
 * @returns One error finding per package outside the allowlist
 */
export function evaluateProductionTree(packages: readonly LicensedPackage[]): LicenseFinding[] {
  const findings: LicenseFinding[] = [];

  for (const entry of packages) {
    if (isLicenseAllowed(entry.license)) continue;

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

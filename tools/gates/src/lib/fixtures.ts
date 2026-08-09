/**
 * License policy for vendored fixtures, zone 3 of SPEC 0.
 *
 * A fixture is a third party document sitting in the repository as test data. It is a
 * separate work, not a derivative of the codebase and not something the codebase derives
 * from. It does not ship in a tarball, does not link into a consumer's code, and creates no
 * obligation for anyone downstream of a published package. That is why this zone is wider
 * than the production allowlist, and why it is checked separately rather than folded into
 * the dependency check: the two answer different questions about different material.
 *
 * What it is not wider about: a no derivatives or a non commercial clause. A corpus exists
 * to be modified and redistributed with the repository, so a license forbidding either is
 * unusable here no matter how permissive it looks in other respects.
 */

/** Licenses a vendored fixture may carry, per SPEC 0 zone 3. */
export const FIXTURE_ALLOWED_LICENSES: readonly string[] = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC0-1.0',
  'Unlicense',
];

/**
 * Clauses that make a license unusable for a corpus, whatever else it permits.
 *
 * These are matched on the identifier rather than looked up in a table, because the point is
 * the clause and not the particular license that carries it. `CC-BY-NC-SA-4.0` is refused for
 * the same reason `CC-BY-NC-4.0` is.
 */
export const FIXTURE_FORBIDDEN_CLAUSES: readonly (readonly [RegExp, string])[] = [
  [/-NC(-|$)/i, 'non commercial clause forbids the use this repository puts fixtures to'],
  [/-ND(-|$)/i, 'no derivatives clause forbids the modification a corpus requires'],
  [/^Commons-Clause/i, 'the Commons Clause restricts the field of use'],
];

/** One entry of the corpus manifest. */
export interface FixtureManifestEntry {
  readonly file: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly license: string;
  readonly copyrightHolder: string;
  readonly modified: boolean;
  /** Required when `modified` is true: what was changed, so CC-BY attribution stays honest. */
  readonly modifications?: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** A problem found in the corpus. */
export interface FixtureFinding {
  readonly level: 'error' | 'warning';
  readonly file: string;
  readonly reason: string;
}

/** What the gate was given to check. */
export interface FixtureAudit {
  /** Files actually present under the corpus documents directory. */
  readonly presentFiles: readonly string[];
  /** Entries read from the manifest. */
  readonly entries: readonly FixtureManifestEntry[];
  /** Contents of the NOTICE file that sits beside them, empty when there is none. */
  readonly notice: string;
  /** Actual SHA-256 of each present file, keyed by file name. */
  readonly digests: Readonly<Record<string, string>>;
}

/**
 * Reports whether a license identifier is usable for a vendored fixture.
 *
 * @param license - SPDX identifier as written in the manifest
 * @returns The reason it is refused, or null when it is allowed
 *
 * @example
 * refuseFixtureLicense('CC-BY-4.0');    // null
 * refuseFixtureLicense('CC-BY-NC-4.0'); // 'non commercial clause ...'
 */
export function refuseFixtureLicense(license: string): string | null {
  const trimmed = license.trim();

  if (trimmed === '') return 'no license recorded';

  for (const [pattern, reason] of FIXTURE_FORBIDDEN_CLAUSES) {
    if (pattern.test(trimmed)) return reason;
  }

  if (!FIXTURE_ALLOWED_LICENSES.includes(trimmed)) {
    return `license is outside the fixture set (${FIXTURE_ALLOWED_LICENSES.join(', ')})`;
  }

  return null;
}

/**
 * Checks a vendored corpus against zone 3 of SPEC 0.
 *
 * Four things fail: a file with no manifest entry, an entry missing its license or its
 * source URL, a license outside the fixture set, and a modified document that does not say
 * how it was modified. Two more fail because attribution has to stay attached and honest: a
 * document the NOTICE does not mention, and a file whose bytes no longer match the recorded
 * digest.
 *
 * @param audit - Files present, manifest entries, NOTICE text and actual digests
 * @returns Every problem found, ordered by file
 *
 * @example
 * auditFixtures({ presentFiles: ['a.yaml'], entries: [], notice: '', digests: {} });
 * // [{ level: 'error', file: 'a.yaml', reason: 'vendored with no manifest entry ...' }]
 */
export function auditFixtures(audit: FixtureAudit): FixtureFinding[] {
  const findings: FixtureFinding[] = [];
  const byFile = new Map(audit.entries.map((entry) => [entry.file, entry]));

  for (const file of [...audit.presentFiles].sort()) {
    const entry = byFile.get(file);

    if (entry === undefined) {
      findings.push({
        level: 'error',
        file,
        reason:
          'vendored with no manifest entry, so its source, license and copyright holder are unrecorded',
      });
      continue;
    }

    if (entry.sourceUrl.trim() === '') {
      findings.push({ level: 'error', file, reason: 'manifest entry records no source URL' });
    }

    if (entry.retrievedAt.trim() === '') {
      findings.push({ level: 'error', file, reason: 'manifest entry records no retrieval date' });
    }

    if (entry.copyrightHolder.trim() === '') {
      findings.push({
        level: 'error',
        file,
        reason: 'manifest entry records no copyright holder, which attribution needs',
      });
    }

    const refusal = refuseFixtureLicense(entry.license);
    if (refusal !== null) {
      findings.push({ level: 'error', file, reason: `${entry.license || '(none)'}: ${refusal}` });
    }

    if (entry.modified && (entry.modifications ?? '').trim() === '') {
      findings.push({
        level: 'error',
        file,
        reason:
          'recorded as modified but does not say how; CC-BY requires modifications to be indicated',
      });
    }

    const digest = audit.digests[file];
    if (digest !== undefined && digest !== entry.sha256) {
      findings.push({
        level: 'error',
        file,
        reason: `bytes no longer match the recorded digest, so the manifest describes a document that is not here. Recorded ${entry.sha256.slice(0, 12)}, found ${digest.slice(0, 12)}`,
      });
    }

    if (!audit.notice.includes(file)) {
      findings.push({
        level: 'error',
        file,
        reason: 'NOTICE does not mention it, so attribution would not travel with the file',
      });
    }
  }

  const present = new Set(audit.presentFiles);
  for (const entry of audit.entries) {
    if (present.has(entry.file)) continue;
    findings.push({
      level: 'warning',
      file: entry.file,
      reason: 'manifest entry matches no file in the corpus; remove it',
    });
  }

  return findings;
}

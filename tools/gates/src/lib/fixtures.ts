/**
 * License policy for vendored material, zones 3 and 4 of SPEC 0.
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

/**
 * Zone 4 differs from zone 3 in one direction and is checked by the same six questions.
 *
 * A fixture never leaves the repository, so its obligation is discharged by attribution inside
 * the repository. A dependency links into someone else's build, so its obligation reaches the
 * consumer's code. A font does neither: it sits in the tarball as a file and is handed to a
 * browser as a file, so its obligation travels with it and with nothing else. That is why SIL
 * OFL 1.1 is usable for an asset and not for a dependency, and why the check is this one with
 * a different allowed set rather than a third piece of machinery.
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

/** Licenses a shipped asset may carry, per SPEC 0 zone 4: OFL plus the production set. */
export const ASSET_ALLOWED_LICENSES: readonly string[] = [
  'OFL-1.1',
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
  /**
   * A human readable name for the NOTICE and for a reader of the manifest.
   *
   * RECORDED AND CHECKED BY NOTHING, said here rather than left to be discovered. There is
   * nothing to check it against: it is prose about someone else's document. It is named as
   * unchecked because the alternative is a reader assuming otherwise, which is the defect class
   * SPEC 0 calls measured but never asserted.
   */
  readonly title: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly license: string;
  readonly copyrightHolder: string;
  readonly modified: boolean;
  /** Required when `modified` is true: what was changed, so CC-BY attribution stays honest. */
  readonly modifications?: string;
  /**
   * Size of the file, checked against the file.
   *
   * IT WAS RECORDED AND UNREAD UNTIL 2026-08-10, and the audit of that day said in as many
   * words that the gate re-read both this and the digest. It read the digest. The check is
   * subordinate to the digest and cannot catch anything the digest misses, and it is here
   * because a number sitting beside a checked one reads as checked: the honest choices were to
   * verify it or to delete it, and there is no third one.
   */
  readonly bytes: number;
  readonly sha256: string;

  /** Zone 4 only: the family this file belongs to. */
  readonly family?: string;
  /** Zone 4 only: the family name the subset actually ships under. */
  readonly shipsAs?: string;
  /** Zone 4 only: the licence text beside the files, which is where the RFN is read from. */
  readonly licenseTextFile?: string;
  /**
   * Zone 4 only: the Reserved Font Name this family declares, or `null` when it declares none.
   *
   * Recorded rather than derived, and then checked against the licence text. A manifest that
   * says `null` for a family that declares one is the failure this field exists to catch.
   */
  readonly reservedFontName?: string | null;
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
  /** Actual size of each present file, keyed by file name, so the recorded `bytes` is read. */
  readonly sizes?: Readonly<Record<string, number>>;
  /** Licenses this material may carry. Defaults to the zone 3 set. */
  readonly allowedLicenses?: readonly string[];
  /**
   * Zone 4 only: the text of each licence file beside the material, keyed by file name.
   *
   * Absent for zone 3, where there is no per family licence text to read.
   */
  readonly licenseTexts?: Readonly<Record<string, string>>;
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
export function refuseFixtureLicense(
  license: string,
  allowed: readonly string[] = FIXTURE_ALLOWED_LICENSES,
): string | null {
  const trimmed = license.trim();

  if (trimmed === '') return 'no license recorded';

  for (const [pattern, reason] of FIXTURE_FORBIDDEN_CLAUSES) {
    if (pattern.test(trimmed)) return reason;
  }

  if (!allowed.includes(trimmed)) {
    return `license is outside the allowed set (${allowed.join(', ')})`;
  }

  return null;
}

/**
 * The Reserved Font Name a licence text declares, or null when it declares none.
 *
 * OFL puts the declaration in the copyright line at the top of the file, in the form
 * `Copyright (c) 2020 ..., with Reserved Font Name "Example"`. The body of every OFL text also
 * contains the sentence that defines the term, so a search of the whole file reports a
 * declaration for every family that ever shipped one, which is all of them. The header is
 * therefore read on its own: everything before the sentence that begins the licence proper.
 *
 * The position is read per family rather than assumed to be the same across families, which is
 * the whole point of the check. Most families declare nothing, and that is a result of reading
 * their file, not a default.
 *
 * @param licenseText - The contents of a `<Family>-OFL.txt`
 * @returns The reserved name, or null
 *
 * @example
 * reservedFontName('Copyright 2020 X, with Reserved Font Name "Example"\n\nThis Font Software');
 */
export function reservedFontName(licenseText: string): string | null {
  const bodyAt = licenseText.search(/^This Font Software is licensed under/m);
  const header = bodyAt === -1 ? licenseText.slice(0, 2000) : licenseText.slice(0, bodyAt);

  const declared = /with\s+Reserved\s+Font\s+Names?\s*([^\n]*)/i.exec(header);
  if (declared === null) return null;

  const names = [...(declared[1] ?? '').matchAll(/["\u201c]([^"\u201d]+)["\u201d]/g)].map(
    (match) => match[1] ?? '',
  );

  return names.length === 0 ? (declared[1] ?? '').trim() || null : names.join(', ');
}

/**
 * The Reserved Font Name half of zone 4, per SPEC 0.
 *
 * Three ways this fails, and the first is the one worth stating: a family that declares a
 * reserved name may not ship a modified version under it, and a subset is a modification. The
 * other two are about the manifest telling the truth, because the manifest is what a reader
 * sees and the licence text is what binds.
 *
 * Returns nothing at all when no licence texts were supplied, which is zone 3.
 */
function auditReservedFontName(
  audit: FixtureAudit,
  entry: FixtureManifestEntry,
  file: string,
): FixtureFinding[] {
  if (audit.licenseTexts === undefined) return [];

  const findings: FixtureFinding[] = [];
  const textFile = entry.licenseTextFile ?? '';

  if (textFile === '') {
    return [
      {
        level: 'error',
        file,
        reason: 'manifest entry names no licence text file, so the reserved name cannot be read',
      },
    ];
  }

  const text = audit.licenseTexts[textFile];
  if (text === undefined) {
    return [
      {
        level: 'error',
        file,
        reason: `licence text ${textFile} is not beside the files, so the licence would not travel with them`,
      },
    ];
  }

  const declared = reservedFontName(text);
  const recorded = entry.reservedFontName ?? null;

  if (declared !== recorded) {
    findings.push({
      level: 'error',
      file,
      reason: `${textFile} declares reserved font name ${declared ?? '(none)'} and the manifest records ${recorded ?? '(none)'}`,
    });
  }

  if (declared !== null && entry.modified) {
    const shipsAs = entry.shipsAs ?? entry.family ?? '';
    if (shipsAs !== '' && declared.split(', ').includes(shipsAs)) {
      findings.push({
        level: 'error',
        file,
        reason: `subset of a family that reserves the name ${declared}, shipped as ${shipsAs}; a modified version may not use a reserved font name`,
      });
    }
  }

  return findings;
}

/**
 * Checks vendored material against zone 3 or zone 4 of SPEC 0.
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

    const refusal = refuseFixtureLicense(entry.license, audit.allowedLicenses);
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

    const size = audit.sizes?.[file];
    if (size !== undefined && size !== entry.bytes) {
      findings.push({
        level: 'error',
        file,
        reason: `manifest records ${String(entry.bytes)} bytes and the file is ${String(size)}`,
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

    findings.push(...auditReservedFontName(audit, entry, file));
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

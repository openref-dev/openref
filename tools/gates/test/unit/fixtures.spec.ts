import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSET_ALLOWED_LICENSES,
  auditFixtures,
  FIXTURE_ALLOWED_LICENSES,
  refuseFixtureLicense,
  reservedFontName,
  type FixtureAudit,
  type FixtureManifestEntry,
} from '../../src/lib/fixtures';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

function entryWith(overrides: Partial<FixtureManifestEntry> = {}): FixtureManifestEntry {
  return {
    file: 'petstore.yaml',
    title: 'Petstore',
    sourceUrl: 'https://example.com/petstore.yaml',
    retrievedAt: '2026-08-09',
    license: 'Apache-2.0',
    copyrightHolder: 'OpenAPI Initiative',
    modified: false,
    bytes: 10,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

function auditWith(overrides: Partial<FixtureAudit> = {}): FixtureAudit {
  const entry = entryWith();
  return {
    presentFiles: [entry.file],
    entries: [entry],
    notice: `documents/${entry.file} by ${entry.copyrightHolder}`,
    digests: { [entry.file]: entry.sha256 },
    ...overrides,
  };
}

describe('refuseFixtureLicense', () => {
  it('should allow every license on the fixture set', () => {
    // Given
    const licenses = FIXTURE_ALLOWED_LICENSES;

    // When
    const refusals = licenses.map((license) => refuseFixtureLicense(license));

    // Then
    expect(refusals).toEqual(licenses.map(() => null));
  });

  it('should allow CC-BY-4.0, which the production allowlist does not', () => {
    // Given
    const license = 'CC-BY-4.0';

    // When
    const refusal = refuseFixtureLicense(license);

    // Then
    expect(refusal).toBeNull();
  });

  it('should refuse a non commercial clause', () => {
    // Given
    const license = 'CC-BY-NC-4.0';

    // When
    const refusal = refuseFixtureLicense(license);

    // Then
    expect(refusal).toContain('non commercial');
  });

  it('should refuse a no derivatives clause, which a corpus cannot live with', () => {
    // Given
    const license = 'CC-BY-ND-4.0';

    // When
    const refusal = refuseFixtureLicense(license);

    // Then
    expect(refusal).toContain('no derivatives');
  });

  it('should refuse a non commercial clause carried inside a longer identifier', () => {
    // Given
    const license = 'CC-BY-NC-SA-4.0';

    // When
    const refusal = refuseFixtureLicense(license);

    // Then
    expect(refusal).toContain('non commercial');
  });

  it('should refuse strong copyleft, which is on neither set', () => {
    // Given
    const license = 'GPL-3.0-only';

    // When
    const refusal = refuseFixtureLicense(license);

    // Then
    expect(refusal).toContain('outside the allowed set');
  });

  it('should refuse an empty license', () => {
    // Given
    const license = '  ';

    // When
    const refusal = refuseFixtureLicense(license);

    // Then
    expect(refusal).toBe('no license recorded');
  });
});

describe('auditFixtures', () => {
  it('should report nothing for a fully attributed corpus', () => {
    // Given
    const audit = auditWith();

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings).toEqual([]);
  });

  it('should fail a vendored file with no manifest entry', () => {
    // Given
    const audit = auditWith({ entries: [] });

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings[0]?.level).toBe('error');
    expect(findings[0]?.reason).toContain('no manifest entry');
  });

  it('should fail an entry with no source URL', () => {
    // Given
    const audit = auditWith({ entries: [entryWith({ sourceUrl: '' })] });

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings.map((finding) => finding.reason)).toContain(
      'manifest entry records no source URL',
    );
  });

  it('should fail an entry with no license', () => {
    // Given
    const audit = auditWith({ entries: [entryWith({ license: '' })] });

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings.some((finding) => finding.reason.includes('no license recorded'))).toBe(true);
  });

  it('should fail an entry with no copyright holder, which attribution needs', () => {
    // Given
    const audit = auditWith({ entries: [entryWith({ copyrightHolder: '' })] });

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings.some((finding) => finding.reason.includes('copyright holder'))).toBe(true);
  });

  it('should fail a document modified without saying how, which CC-BY forbids', () => {
    // Given
    const audit = auditWith({ entries: [entryWith({ modified: true })] });

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings.some((finding) => finding.reason.includes('does not say how'))).toBe(true);
  });

  it('should accept a document modified with a description of the change', () => {
    // Given
    const audit = auditWith({
      entries: [entryWith({ modified: true, modifications: 'truncated to the first 50 paths' })],
    });

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings).toEqual([]);
  });

  it('should fail a document the NOTICE does not mention', () => {
    // Given
    const audit = auditWith({ notice: 'a NOTICE about something else' });

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings.some((finding) => finding.reason.includes('NOTICE does not mention'))).toBe(
      true,
    );
  });

  it('should fail a file whose bytes no longer match the recorded digest', () => {
    // Given
    const audit = auditWith({ digests: { 'petstore.yaml': 'b'.repeat(64) } });

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings.some((finding) => finding.reason.includes('no longer match'))).toBe(true);
  });

  it('should warn about a manifest entry that matches no file', () => {
    // Given
    const audit = auditWith({ presentFiles: [], digests: {} });

    // When
    const findings = auditFixtures(audit);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('warning');
    expect(findings[0]?.file).toBe('petstore.yaml');
    expect(findings[0]?.reason).toContain('matches no file');
  });
});

/**
 * Zone 4 of SPEC 0: material that ships to a user inside a published package.
 *
 * The header below is synthetic so that a declared reserved name can be planted, which no
 * shipped family gives us. The last test in this block reads the two real licence texts, so
 * the synthetic ones are never the only thing the check was tried against.
 */
describe('the shipped asset zone', () => {
  const OFL_HEADER = [
    'Copyright 2020 The Example Project Authors (https://example.invalid)',
    '',
    'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    '',
    '"Reserved Font Name" refers to any names specified as such after the',
    'copyright statement(s).',
    '',
  ].join('\n');

  it('should allow SIL OFL 1.1 for an asset and refuse it for a fixture', () => {
    // Given, a font ships and does not link, so its obligation travels with the file.

    // When
    const asAsset = refuseFixtureLicense('OFL-1.1', ASSET_ALLOWED_LICENSES);

    // Then
    expect(asAsset).toBeNull();
    expect(refuseFixtureLicense('OFL-1.1', FIXTURE_ALLOWED_LICENSES)).toContain(
      'outside the allowed set',
    );
  });

  it('should refuse a no derivatives clause for an asset too, since a subset is a derivative', () => {
    // Given
    const license = 'CC-BY-ND-4.0';

    // When
    const refusal = refuseFixtureLicense(license, ASSET_ALLOWED_LICENSES);

    // Then
    expect(refusal).toContain('no derivatives');
  });

  it('should not read the sentence that defines the term as a declaration of one', () => {
    // Given, that sentence is in the body of every OFL text, so a whole file search would
    // report a reserved name for every family that ever shipped one, which is all of them.

    // When
    const declared = reservedFontName(OFL_HEADER);

    // Then
    expect(declared).toBeNull();
  });

  it('should read a reserved name out of the copyright line where OFL puts it', () => {
    // Given
    const text = OFL_HEADER.replace(
      'Authors (https://example.invalid)',
      'Authors (https://example.invalid), with Reserved Font Name "Example Sans"',
    );

    // When
    const declared = reservedFontName(text);

    // Then
    expect(declared).toBe('Example Sans');
  });

  it('should read two reserved names when a family declares two', () => {
    // Given
    const text = OFL_HEADER.replace(
      'Authors (https://example.invalid)',
      'Authors, with Reserved Font Names "Example Sans" and "Example Mono"',
    );

    // When
    const declared = reservedFontName(text);

    // Then
    expect(declared).toBe('Example Sans, Example Mono');
  });

  it('should refuse a subset that ships under a name its family reserves', () => {
    // Given
    const text = OFL_HEADER.replace(
      'Authors (https://example.invalid)',
      'Authors, with Reserved Font Name "Example Sans"',
    );
    const entry = entryWith({
      file: 'ExampleSans-400.woff2',
      license: 'OFL-1.1',
      licenseTextFile: 'ExampleSans-OFL.txt',
      reservedFontName: 'Example Sans',
      shipsAs: 'Example Sans',
      modified: true,
      modifications: 'subset to latin',
      sha256: 'deadbeef',
    });

    // When
    const findings = auditFixtures({
      presentFiles: ['ExampleSans-400.woff2'],
      entries: [entry],
      notice: 'ExampleSans-400.woff2',
      digests: { 'ExampleSans-400.woff2': 'deadbeef' },
      allowedLicenses: ASSET_ALLOWED_LICENSES,
      licenseTexts: { 'ExampleSans-OFL.txt': text },
    });

    // Then
    expect(findings.map((finding) => finding.reason)).toEqual([
      expect.stringContaining('a modified version may not use a reserved font name'),
    ]);
  });

  it('should accept the same subset once it ships under a different name', () => {
    // Given
    const text = OFL_HEADER.replace(
      'Authors (https://example.invalid)',
      'Authors, with Reserved Font Name "Example Sans"',
    );
    const entry = entryWith({
      file: 'ExampleSans-400.woff2',
      license: 'OFL-1.1',
      licenseTextFile: 'ExampleSans-OFL.txt',
      reservedFontName: 'Example Sans',
      shipsAs: 'Openref Sans',
      modified: true,
      modifications: 'subset to latin',
      sha256: 'deadbeef',
    });

    // When
    const findings = auditFixtures({
      presentFiles: ['ExampleSans-400.woff2'],
      entries: [entry],
      notice: 'ExampleSans-400.woff2',
      digests: { 'ExampleSans-400.woff2': 'deadbeef' },
      allowedLicenses: ASSET_ALLOWED_LICENSES,
      licenseTexts: { 'ExampleSans-OFL.txt': text },
    });

    // Then
    expect(findings).toEqual([]);
  });

  it('should refuse a manifest that records no reserved name for a family that declares one', () => {
    // Given, the licence text binds and the manifest is what a reader sees.
    const text = OFL_HEADER.replace(
      'Authors (https://example.invalid)',
      'Authors, with Reserved Font Name "Example Sans"',
    );
    const entry = entryWith({
      file: 'ExampleSans-400.woff2',
      license: 'OFL-1.1',
      licenseTextFile: 'ExampleSans-OFL.txt',
      reservedFontName: null,
      shipsAs: 'Openref Sans',
      modified: true,
      modifications: 'subset to latin',
      sha256: 'deadbeef',
    });

    // When
    const findings = auditFixtures({
      presentFiles: ['ExampleSans-400.woff2'],
      entries: [entry],
      notice: 'ExampleSans-400.woff2',
      digests: { 'ExampleSans-400.woff2': 'deadbeef' },
      allowedLicenses: ASSET_ALLOWED_LICENSES,
      licenseTexts: { 'ExampleSans-OFL.txt': text },
    });

    // Then
    expect(findings.map((finding) => finding.reason)).toEqual([
      expect.stringContaining('declares reserved font name Example Sans'),
    ]);
  });

  it('should refuse an asset whose licence text is not beside it', () => {
    // Given
    const entry = entryWith({
      file: 'ExampleSans-400.woff2',
      license: 'OFL-1.1',
      licenseTextFile: 'ExampleSans-OFL.txt',
      reservedFontName: null,
      modified: true,
      modifications: 'subset to latin',
      sha256: 'deadbeef',
    });

    // When
    const findings = auditFixtures({
      presentFiles: ['ExampleSans-400.woff2'],
      entries: [entry],
      notice: 'ExampleSans-400.woff2',
      digests: { 'ExampleSans-400.woff2': 'deadbeef' },
      allowedLicenses: ASSET_ALLOWED_LICENSES,
      licenseTexts: {},
    });

    // Then
    expect(findings.map((finding) => finding.reason)).toEqual([
      expect.stringContaining('would not travel with them'),
    ]);
  });

  it('should read the reserved name a real family declares, in the form that family wrote it', () => {
    // Given, the copyright line of IBM Plex, verbatim. Every plant above is synthetic; this is
    // a family that really does reserve a name, and reading it is what caused the forge design
    // to swap its mono family on 2026-08-10 rather than rename a subset.
    const text = [
      'Copyright \u00a9 2017 IBM Corp. with Reserved Font Name "Plex"',
      '',
      'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
      '',
    ].join('\n');

    // When
    const declared = reservedFontName(text);

    // Then
    expect(declared).toBe('Plex');
  });

  it('should report no reserved name for either family this repository ships', () => {
    // Given, the real texts. This is a reading of two files and not an assumption that
    // families agree: the check exists because the declaration is not in a fixed place.
    const directory = join(REPO_ROOT, 'packages', 'theme', 'fonts');

    // When
    const declared = ['SpaceGrotesk-OFL.txt', 'JetBrainsMono-OFL.txt'].map((file) =>
      reservedFontName(readFileSync(join(directory, file), 'utf8')),
    );

    // Then
    expect(declared).toEqual([null, null]);
  });

  it('should ask nothing about reserved names in zone 3, which has no licence texts', () => {
    // Given, a corpus document has no family and no OFL header.
    const entry = entryWith({ sha256: 'deadbeef' });

    // When
    const findings = auditFixtures({
      presentFiles: ['petstore.yaml'],
      entries: [entry],
      notice: 'petstore.yaml',
      digests: { 'petstore.yaml': 'deadbeef' },
    });

    // Then
    expect(findings).toEqual([]);
  });
});

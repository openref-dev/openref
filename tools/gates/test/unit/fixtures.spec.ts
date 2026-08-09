import { describe, expect, it } from 'vitest';
import {
  auditFixtures,
  FIXTURE_ALLOWED_LICENSES,
  refuseFixtureLicense,
  type FixtureAudit,
  type FixtureManifestEntry,
} from '../../src/lib/fixtures';

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
    expect(refusal).toContain('outside the fixture set');
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

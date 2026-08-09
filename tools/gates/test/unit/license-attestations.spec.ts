import { describe, expect, it } from 'vitest';
import {
  checkLicenseAttestation,
  findStaleAttestations,
  hashLicenseText,
  packageKey,
  type LicenseAttestation,
} from '../../src/lib/licenses';

const TEXT = 'Permission is hereby granted, free of charge, to any person obtaining a copy\n';
const SHA = hashLicenseText(TEXT);

const ENTRY = { name: 'spawndamnit', versions: ['3.0.1'] } as const;
const RESOLUTION = { file: 'LICENSE', sha256: SHA } as const;

const RECORD: LicenseAttestation = {
  package: 'spawndamnit@3.0.1',
  license: 'MIT',
  file: 'LICENSE',
  sha256: SHA,
};

describe('packageKey', () => {
  it('should include the version, so a record cannot outlive the version it was taken at', () => {
    // Given
    const entry = { name: 'spawndamnit', versions: ['3.0.1'] };

    // When
    const key = packageKey(entry);

    // Then
    expect(key).toBe('spawndamnit@3.0.1');
  });

  it('should order multiple versions so the key does not depend on report order', () => {
    // Given
    const one = { name: 'a', versions: ['2.0.0', '1.0.0'] };
    const other = { name: 'a', versions: ['1.0.0', '2.0.0'] };

    // When
    const keys = [packageKey(one), packageKey(other)];

    // Then
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('hashLicenseText', () => {
  it('should produce a different hash for text that changed by one character', () => {
    // Given
    const changed = `${TEXT}Copyright (c) 2027\n`;

    // When
    const hashes = [hashLicenseText(TEXT), hashLicenseText(changed)];

    // Then
    expect(hashes[0]).not.toBe(hashes[1]);
  });
});

describe('checkLicenseAttestation', () => {
  it('should accept a reading that matches the recorded text', () => {
    // Given
    const attestations = [RECORD];

    // When
    const finding = checkLicenseAttestation(ENTRY, RESOLUTION, 'MIT', attestations);

    // Then
    expect(finding).toBeNull();
  });

  it('should reject a reading that was never recorded', () => {
    // Given
    const attestations: LicenseAttestation[] = [];

    // When
    const finding = checkLicenseAttestation(ENTRY, RESOLUTION, 'MIT', attestations);

    // Then
    expect(finding?.level).toBe('error');
    expect(finding?.reason).toContain('no recorded reading');
  });

  it('should reject a new version of a package whose old version was recorded', () => {
    // Given
    const nextVersion = { name: 'spawndamnit', versions: ['3.1.0'] };

    // When
    const finding = checkLicenseAttestation(nextVersion, RESOLUTION, 'MIT', [RECORD]);

    // Then
    expect(finding?.level).toBe('error');
    expect(finding?.reason).toContain('no recorded reading');
  });

  it('should reject a license file whose text changed since it was recorded', () => {
    // Given
    const changed = { file: 'LICENSE', sha256: hashLicenseText(`${TEXT}and then some\n`) };

    // When
    const finding = checkLicenseAttestation(ENTRY, changed, 'MIT', [RECORD]);

    // Then
    expect(finding?.level).toBe('error');
    expect(finding?.reason).toContain('changed since it was read');
  });

  it('should reject a reading taken from a different file than the one recorded', () => {
    // Given
    const otherFile = { file: 'COPYING', sha256: SHA };

    // When
    const finding = checkLicenseAttestation(ENTRY, otherFile, 'MIT', [RECORD]);

    // Then
    expect(finding?.level).toBe('error');
    expect(finding?.reason).toContain('COPYING');
  });

  it('should reject text that now reads as a different license than was recorded', () => {
    // Given
    const attestations = [RECORD];

    // When
    const finding = checkLicenseAttestation(ENTRY, RESOLUTION, 'BSD-3-Clause', attestations);

    // Then
    expect(finding?.level).toBe('error');
    expect(finding?.reason).toContain('MIT');
  });
});

describe('findStaleAttestations', () => {
  it('should report a record that matched nothing in the tree', () => {
    // Given
    const used = new Set<string>();

    // When
    const findings = findStaleAttestations([RECORD], used);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('warning');
  });

  it('should report nothing when every record was used', () => {
    // Given
    const used = new Set(['spawndamnit@3.0.1']);

    // When
    const findings = findStaleAttestations([RECORD], used);

    // Then
    expect(findings).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyRestrictiveFamily,
  detectLicenseFromText,
  evaluateDevelopmentTree,
  evaluateProductionTree,
  flattenLicenseReport,
  isLicenseAllowed,
  isUnidentifiedLicense,
  splitLicenseExpression,
  type LicensedPackage,
  type PnpmLicenseReport,
} from '../../src/lib/licenses';

function packageWith(name: string, license: string): LicensedPackage {
  return { name, versions: ['1.0.0'], license, paths: [`/store/${name}`] };
}

describe('isLicenseAllowed', () => {
  it('should accept every license on the production allowlist', () => {
    // Given
    const allowed = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'];

    // When
    const results = allowed.map((license) => isLicenseAllowed(license));

    // Then
    expect(results).toEqual([true, true, true, true, true]);
  });

  it('should accept a dual license when one branch is on the allowlist', () => {
    // Given
    const expression = '(MPL-2.0 OR MIT)';

    // When
    const result = isLicenseAllowed(expression);

    // Then
    expect(result).toBe(true);
  });

  it('should reject a conjunction when one identifier is off the allowlist', () => {
    // Given
    const expression = 'MIT AND GPL-2.0-only';

    // When
    const result = isLicenseAllowed(expression);

    // Then
    expect(result).toBe(false);
  });

  it('should reject a permissive license that is not on the allowlist', () => {
    // Given
    const expression = 'Python-2.0';

    // When
    const result = isLicenseAllowed(expression);

    // Then
    expect(result).toBe(false);
  });

  it('should reject an unidentifiable license', () => {
    // Given
    const expressions = ['Unknown', 'UNLICENSED', 'SEE LICENSE IN LICENSE', ''];

    // When
    const results = expressions.map((expression) => isLicenseAllowed(expression));

    // Then
    expect(results).toEqual([false, false, false, false]);
  });

  it('should ignore a WITH exception clause and judge the base license', () => {
    // Given
    const expression = 'Apache-2.0 WITH LLVM-exception';

    // When
    const result = isLicenseAllowed(expression);

    // Then
    expect(result).toBe(true);
  });
});

describe('isUnidentifiedLicense', () => {
  it('should treat a pointer to a license file as unidentified', () => {
    // Given
    const expression = 'SEE LICENSE IN LICENSE';

    // When
    const result = isUnidentifiedLicense(expression);

    // Then
    expect(result).toBe(true);
  });

  it('should treat a real SPDX identifier as identified', () => {
    // Given
    const expression = 'BSD-3-Clause';

    // When
    const result = isUnidentifiedLicense(expression);

    // Then
    expect(result).toBe(false);
  });
});

describe('splitLicenseExpression', () => {
  it('should flatten a nested expression into its identifiers', () => {
    // Given
    const expression = '(MIT OR (Apache-2.0 AND BSD-3-Clause))';

    // When
    const result = splitLicenseExpression(expression);

    // Then
    expect(result).toEqual(['MIT', 'Apache-2.0', 'BSD-3-Clause']);
  });
});

describe('classifyRestrictiveFamily', () => {
  it('should classify GPL as strong copyleft', () => {
    // Given
    const expression = 'GPL-3.0-or-later';

    // When
    const result = classifyRestrictiveFamily(expression);

    // Then
    expect(result).toBe('strong-copyleft');
  });

  it('should classify MPL as weak copyleft', () => {
    // Given
    const expression = 'MPL-2.0';

    // When
    const result = classifyRestrictiveFamily(expression);

    // Then
    expect(result).toBe('weak-copyleft');
  });

  it('should classify a source available license ahead of copyleft', () => {
    // Given
    const expression = 'BUSL-1.1';

    // When
    const result = classifyRestrictiveFamily(expression);

    // Then
    expect(result).toBe('source-available');
  });

  it('should not classify a dual license that offers an allowed branch', () => {
    // Given
    const expression = 'GPL-2.0-only OR MIT';

    // When
    const result = classifyRestrictiveFamily(expression);

    // Then
    expect(result).toBeNull();
  });
});

describe('evaluateProductionTree', () => {
  it('should pass a tree where every license is on the allowlist', () => {
    // Given
    const packages = [packageWith('a', 'MIT'), packageWith('b', 'Apache-2.0')];

    // When
    const findings = evaluateProductionTree(packages);

    // Then
    expect(findings).toEqual([]);
  });

  it('should fail on a planted copyleft package', () => {
    // Given
    const packages = [packageWith('honest-dep', 'MIT'), packageWith('planted-gpl', 'GPL-3.0-only')];

    // When
    const findings = evaluateProductionTree(packages);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.packageName).toBe('planted-gpl');
    expect(findings[0]?.level).toBe('error');
  });

  it('should fail on a permissive license that is off the allowlist', () => {
    // Given
    const packages = [packageWith('argparse', 'Python-2.0')];

    // When
    const findings = evaluateProductionTree(packages);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('outside the allowlist');
  });
});

describe('evaluateDevelopmentTree', () => {
  it('should fail on a planted copyleft package', () => {
    // Given
    const packages = [packageWith('planted-agpl', 'AGPL-3.0-only')];

    // When
    const findings = evaluateDevelopmentTree(packages);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('error');
    expect(findings[0]?.reason).toContain('strong-copyleft');
  });

  it('should fail on a source available package', () => {
    // Given
    const packages = [packageWith('planted-busl', 'BUSL-1.1')];

    // When
    const findings = evaluateDevelopmentTree(packages);

    // Then
    expect(findings[0]?.level).toBe('error');
    expect(findings[0]?.reason).toContain('source-available');
  });

  it('should fail on a package whose license cannot be identified', () => {
    // Given
    const packages = [packageWith('mystery', 'Unknown')];

    // When
    const findings = evaluateDevelopmentTree(packages);

    // Then
    expect(findings[0]?.level).toBe('error');
    expect(findings[0]?.reason).toContain('could not be identified');
  });

  it('should warn but not fail on weak copyleft in a build time tool', () => {
    // Given
    const packages = [packageWith('lightningcss', 'MPL-2.0')];

    // When
    const findings = evaluateDevelopmentTree(packages);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('warning');
  });

  it('should stay silent on a permissive license that is off the production allowlist', () => {
    // Given
    const packages = [
      packageWith('argparse', 'Python-2.0'),
      packageWith('minimatch', 'BlueOak-1.0.0'),
    ];

    // When
    const findings = evaluateDevelopmentTree(packages);

    // Then
    expect(findings).toEqual([]);
  });
});

describe('flattenLicenseReport', () => {
  it('should flatten and sort the pnpm report by package name', () => {
    // Given
    const report: PnpmLicenseReport = {
      MIT: [{ name: 'zulu', versions: ['2.0.0'], license: 'MIT', paths: ['/store/zulu'] }],
      'Apache-2.0': [
        { name: 'alpha', versions: ['1.1.0', '1.0.0'], license: 'Apache-2.0', paths: ['/store/a'] },
      ],
    };

    // When
    const result = flattenLicenseReport(report);

    // Then
    expect(result.map((entry) => entry.name)).toEqual(['alpha', 'zulu']);
    expect(result[0]?.versions).toEqual(['1.0.0', '1.1.0']);
  });

  it('should fall back to the report key when the entry carries no license', () => {
    // Given
    const report: PnpmLicenseReport = {
      ISC: [{ name: 'quiet', versions: ['1.0.0'], license: '', paths: [] }],
    };

    // When
    const result = flattenLicenseReport(report);

    // Then
    expect(result[0]?.license).toBe('ISC');
  });
});

describe('detectLicenseFromText', () => {
  it('should identify MIT from its grant clause', () => {
    // Given
    const text = 'Permission is hereby granted, free of charge, to any person obtaining a copy';

    // When
    const result = detectLicenseFromText(text);

    // Then
    expect(result).toBe('MIT');
  });

  it('should identify ISC from its grant clause', () => {
    // Given
    const text =
      'Permission to use, copy, modify, and distribute this software for any purpose with or without fee';

    // When
    const result = detectLicenseFromText(text);

    // Then
    expect(result).toBe('ISC');
  });

  it('should identify Apache-2.0 from its header', () => {
    // Given
    const text = 'Apache License\n Version 2.0, January 2004';

    // When
    const result = detectLicenseFromText(text);

    // Then
    expect(result).toBe('Apache-2.0');
  });

  it('should separate BSD-3-Clause from BSD-2-Clause by the endorsement clause', () => {
    // Given
    const two = 'Redistribution and use in source and binary forms, with or without modification';
    const three = `${two}. Neither the name of the copyright holder may be used to endorse`;

    // When
    const results = [detectLicenseFromText(two), detectLicenseFromText(three)];

    // Then
    expect(results).toEqual(['BSD-2-Clause', 'BSD-3-Clause']);
  });

  it('should return null for text it does not recognise', () => {
    // Given
    const text = 'do whatever you feel like, honestly';

    // When
    const result = detectLicenseFromText(text);

    // Then
    expect(result).toBeNull();
  });
});

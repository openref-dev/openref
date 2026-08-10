import { describe, expect, it } from 'vitest';
import {
  ALLOWED_LICENSES,
  classifyRestrictiveFamily,
  DATA_ONLY_LICENSES,
  detectLicenseFromText,
  evaluateDevelopmentTree,
  evaluateProductionTree,
  findNeverShippedViolations,
  findStaleDataOnlyAttestations,
  flattenLicenseReport,
  isLicenseAllowed,
  isUnidentifiedLicense,
  requiresDataOnlyAttestation,
  splitLicenseExpression,
  type DataOnlyAttestation,
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

  it('should accept the three licenses added to the production zone on 2026-08-09', () => {
    // Given
    const added = ['MIT-0', 'BlueOak-1.0.0', 'CC0-1.0'];

    // When
    const results = added.map((license) => isLicenseAllowed(license));

    // Then
    expect(results).toEqual([true, true, true]);
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

describe('requiresDataOnlyAttestation', () => {
  it('should hold every data-only license on the allowlist, since the condition is not a ban', () => {
    // Given
    const dataOnly = DATA_ONLY_LICENSES;

    // When
    const onAllowlist = dataOnly.filter((license) => ALLOWED_LICENSES.includes(license));

    // Then
    expect(onAllowlist).toEqual([...dataOnly]);
  });

  it('should require a reading of a package admitted only by CC0', () => {
    // Given
    const expression = 'CC0-1.0';

    // When
    const result = requiresDataOnlyAttestation(expression);

    // Then
    expect(result).toBe(true);
  });

  it('should require nothing of the unconditional licenses', () => {
    // Given
    const expressions = ['MIT', 'Apache-2.0', 'MIT-0', 'BlueOak-1.0.0'];

    // When
    const results = expressions.map((expression) => requiresDataOnlyAttestation(expression));

    // Then
    expect(results).toEqual([false, false, false, false]);
  });

  it('should require nothing when an unconditional branch can be chosen instead', () => {
    // Given
    const expression = '(CC0-1.0 OR MIT)';

    // When
    const result = requiresDataOnlyAttestation(expression);

    // Then
    expect(result).toBe(false);
  });

  it('should require a reading when CC0 is conjoined rather than offered as an alternative', () => {
    // Given
    const expression = 'MIT AND CC0-1.0';

    // When
    const result = requiresDataOnlyAttestation(expression);

    // Then
    expect(result).toBe(true);
  });

  it('should require nothing of a license that is refused outright', () => {
    // Given
    const expression = 'GPL-3.0-only';

    // When
    const result = requiresDataOnlyAttestation(expression);

    // Then
    expect(result).toBe(false);
  });
});

describe('evaluateProductionTree, data-only condition', () => {
  const record: DataOnlyAttestation = {
    package: 'mdn-data@2.27.1',
    license: 'CC0-1.0',
    rationale: 'reference tables about CSS, no implementation of anything patentable',
  };

  function dataPackage(version: string, license = 'CC0-1.0'): LicensedPackage {
    return { name: 'mdn-data', versions: [version], license, paths: ['/store/mdn-data'] };
  }

  it('should fail a CC0 package that carries no recorded reading', () => {
    // Given
    const packages = [dataPackage('2.27.1')];

    // When
    const findings = evaluateProductionTree(packages, []);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('error');
    expect(findings[0]?.reason).toContain('DATA_ONLY_ATTESTATIONS');
  });

  it('should pass a CC0 package that was read and recorded', () => {
    // Given
    const packages = [dataPackage('2.27.1')];

    // When
    const findings = evaluateProductionTree(packages, [record]);

    // Then
    expect(findings).toEqual([]);
  });

  it('should fail a bumped version, so a package that gained code is looked at again', () => {
    // Given
    const packages = [dataPackage('2.28.0')];

    // When
    const findings = evaluateProductionTree(packages, [record]);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('mdn-data@2.28.0');
  });

  it('should fail when the recorded reading was taken for a different license', () => {
    // Given
    const stale: DataOnlyAttestation = { ...record, license: 'Unlicense' };

    // When
    const findings = evaluateProductionTree([dataPackage('2.27.1')], [stale]);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('taken for Unlicense');
  });

  it('should demand no reading of a package on an unconditional license', () => {
    // Given
    const packages = [packageWith('lru-cache', 'BlueOak-1.0.0'), packageWith('helpers', 'MIT-0')];

    // When
    const findings = evaluateProductionTree(packages, []);

    // Then
    expect(findings).toEqual([]);
  });

  it('should collect the packages that needed a reading', () => {
    // Given
    const used = new Set<string>();
    const packages = [dataPackage('2.27.1'), packageWith('a', 'MIT')];

    // When
    evaluateProductionTree(packages, [record], used);

    // Then
    expect([...used]).toEqual(['mdn-data@2.27.1']);
  });
});

describe('findStaleDataOnlyAttestations', () => {
  it('should warn about a record that matches nothing in the closure', () => {
    // Given
    const records: DataOnlyAttestation[] = [
      { package: 'gone@1.0.0', license: 'CC0-1.0', rationale: 'data' },
    ];

    // When
    const findings = findStaleDataOnlyAttestations(records, new Set<string>());

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('warning');
  });

  it('should stay silent about a record that was used', () => {
    // Given
    const records: DataOnlyAttestation[] = [
      { package: 'mdn-data@2.27.1', license: 'CC0-1.0', rationale: 'data' },
    ];

    // When
    const findings = findStaleDataOnlyAttestations(records, new Set(['mdn-data@2.27.1']));

    // Then
    expect(findings).toEqual([]);
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

describe('findNeverShippedViolations', () => {
  const named = [{ name: 'playwright-core', reason: 'a browser driver, 13 MB, Apache-2.0' }];

  it('should report a named tool that reached the published closure', () => {
    // Given, the case the licence zones cannot catch: Apache-2.0 passes in both of them, so a
    // browser driver crossing into what a consumer installs is invisible to every other check.
    const production = [packageWith('playwright-core', 'Apache-2.0')];
    const development: LicensedPackage[] = [];

    // When
    const findings = findNeverShippedViolations(named, production, development);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('error');
    expect(findings[0]?.reason).toContain('inside the published closure');
  });

  it('should say nothing when the tool is in the development tree where it belongs', () => {
    // Given
    const development = [packageWith('playwright-core', 'Apache-2.0')];

    // When
    const findings = findNeverShippedViolations(named, [], development);

    // Then
    expect(findings).toEqual([]);
  });

  it('should report an entry that matches neither tree, because it can no longer fail', () => {
    // Given, an entry naming something the repository stopped installing. Left alone it reads
    // as coverage while checking nothing, which is the failure this project keeps removing.
    // When
    const findings = findNeverShippedViolations(named, [], []);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('warning');
    expect(findings[0]?.reason).toContain('can no longer fail');
  });

  it('should not confuse a package of the same name in the other tree', () => {
    // Given, present in both, which is what a leaked devDependency looks like
    const both = [packageWith('playwright-core', 'Apache-2.0')];

    // When
    const findings = findNeverShippedViolations(named, both, both);

    // Then
    expect(findings.map((finding) => finding.level)).toEqual(['error']);
  });
});

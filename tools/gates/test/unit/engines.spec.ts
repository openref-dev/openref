import { describe, expect, it } from 'vitest';
import {
  auditEngineRange,
  describeConstraints,
  findDivergentManifests,
} from '../../src/lib/engines';

/** What `jsdom@30.0.1` and `isomorphic-dompurify@3.22.0` both declare today. */
const SANITIZER_RANGE = '^22.22.2 || ^24.15.0 || >=26.0.0';

describe('auditEngineRange', () => {
  it('should replay the incident: the old floor against the range that had moved under it', () => {
    // Given, exactly the state this gate exists for. `>=20.11.0` was declared in every manifest
    // and in SPEC 23, while the sanitizer had already dropped Node 20. Nothing reported it, and
    // the package did not load on any Node 20 at all.
    const declared = '>=20.11.0';

    // When
    const findings = auditEngineRange(declared, [
      { package: 'jsdom@30.0.1', range: SANITIZER_RANGE },
      { package: 'isomorphic-dompurify@3.22.0', range: SANITIZER_RANGE },
    ]);

    // Then
    expect(findings.map((finding) => finding.package)).toEqual([
      'jsdom@30.0.1',
      'isomorphic-dompurify@3.22.0',
    ]);
  });

  it('should be silent once the declared range is the one the closure supports', () => {
    // Given, the same closure and the range that was adopted in answer to it.
    const declared = SANITIZER_RANGE;

    // When
    const findings = auditEngineRange(declared, [
      { package: 'jsdom@30.0.1', range: SANITIZER_RANGE },
      { package: 'undici@8.10.0', range: '>=22.19.0' },
      { package: 'marked@18.0.9', range: '>= 20' },
    ]);

    // Then
    expect(findings).toEqual([]);
  });

  it('should catch a range that is wider at only one end', () => {
    // Given, the failure a reading by eye misses: the floors agree and the ceiling does not.
    const declared = '>=22.22.2';

    // When
    const findings = auditEngineRange(declared, [
      { package: 'narrow@1.0.0', range: '^22.22.2 || ^24.15.0' },
    ]);

    // Then
    expect(findings).toHaveLength(1);
  });

  it('should treat a dependency that declares nothing as constraining nothing', () => {
    // Given, most packages declare no engines, and absence is not a claim of universal support.
    // Such a package never reaches this function; this pins that an empty list is silence
    // rather than a pass computed from something.
    const declared = SANITIZER_RANGE;

    // When
    const findings = auditEngineRange(declared, []);

    // Then
    expect(findings).toEqual([]);
  });

  it('should report a range it cannot parse rather than skipping it', () => {
    // Given, a package whose engines field is prose. Skipping it would make the check quietly
    // narrower than it claims to be.
    const declared = SANITIZER_RANGE;

    // When
    const findings = auditEngineRange(declared, [
      { package: 'odd@1.0.0', range: 'the latest node please' },
    ]);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('not a valid range');
  });

  it('should refuse to check a declared range that is not a range', () => {
    // Given
    const declared = 'whatever works';

    // When
    const act = (): unknown => auditEngineRange(declared, []);

    // Then
    expect(act).toThrow(/not a valid range/);
  });
});

describe('describeConstraints', () => {
  it('should name every range the declaration has to satisfy at once', () => {
    // Given
    const findings = auditEngineRange('>=20.11.0', [
      { package: 'jsdom@30.0.1', range: SANITIZER_RANGE },
      { package: 'undici@8.10.0', range: '>=22.19.0' },
    ]);

    // When
    const described = describeConstraints(findings);

    // Then
    expect(described).toContain('jsdom@30.0.1 wants');
    expect(described).toContain('undici@8.10.0 wants');
  });
});

describe('findDivergentManifests', () => {
  it('should catch a package that promises something the others do not', () => {
    // Given, a consumer installing two published packages gets one runtime, so a wider range in
    // one of them is support that the package beside it does not have.
    const manifests = [
      { name: '@openref/core', range: SANITIZER_RANGE },
      { name: '@openref/nest', range: '>=20.11.0' },
      { name: '@openref/theme', range: undefined },
    ];

    // When
    const divergent = findDivergentManifests(SANITIZER_RANGE, manifests);

    // Then
    expect(divergent).toEqual([
      '@openref/nest declares ">=20.11.0"',
      '@openref/theme declares no engines.node',
    ]);
  });

  it('should be silent when every manifest makes the same promise', () => {
    // Given
    const manifests = [
      { name: '@openref/core', range: SANITIZER_RANGE },
      { name: '@openref/nest', range: SANITIZER_RANGE },
    ];

    // When
    const divergent = findDivergentManifests(SANITIZER_RANGE, manifests);

    // Then
    expect(divergent).toEqual([]);
  });
});

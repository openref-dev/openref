import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHIPPED_CLIENT_BUNDLES } from '../../src/config';
import { ALLOWED_BUNDLE_ORIGINS, findForeignOrigins } from '../../src/lib/bundle-origins';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

describe('findForeignOrigins', () => {
  it('should find an analytics endpoint hidden in a call', () => {
    // Given a bundle that phones home the way one would
    const bundle = 'function t(e){navigator.sendBeacon("https://metrics.example.com/collect",e)}';

    // When
    const findings = findForeignOrigins(bundle);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.origin).toBe('https://metrics.example.com');
  });

  it('should find an address split from its use, since a literal is a literal', () => {
    // Given the address held in a constant far from the request that uses it
    const bundle = 'const E="https://telemetry.example.net/v1";export{E};';

    // When
    const findings = findForeignOrigins(bundle);

    // Then
    expect(findings.map((finding) => finding.origin)).toEqual(['https://telemetry.example.net']);
  });

  it('should report one finding per origin however many times it appears', () => {
    // Given the same host used three times
    const bundle = '"https://a.example.com/1","https://a.example.com/2","https://b.example.com/"';

    // When
    const findings = findForeignOrigins(bundle);

    // Then
    expect(findings.map((finding) => finding.origin)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('should say nothing about the XML namespaces a DOM implementation compares against', () => {
    // Given the namespace strings Vue carries for createElementNS
    const bundle =
      'const s="http://www.w3.org/2000/svg",m="http://www.w3.org/1998/Math/MathML",' +
      'x="http://www.w3.org/1999/xhtml";';

    // When
    const findings = findForeignOrigins(bundle);

    // Then
    expect(findings).toEqual([]);
  });

  it('should report a literal that begins like a URL and does not parse', () => {
    // Given, because skipping an unparseable address would be the way past the check
    const bundle = 'const u="https://";';

    // When
    const findings = findForeignOrigins(bundle);

    // Then
    expect(findings).toHaveLength(1);
  });

  it('should carry a reason and a mechanism for every entry it allows', () => {
    // Given the allowlist is the whole of the exemption, so an entry with no reason is an
    // exemption nobody has to justify
    // When
    // Then
    for (const allowed of ALLOWED_BUNDLE_ORIGINS) {
      expect(allowed.prefix.startsWith('http')).toBe(true);
      expect(allowed.reason.length).toBeGreaterThan(30);
      expect(['namespace', 'diagnostic']).toContain(allowed.kind);
    }
  });

  it('should hold at most one diagnostic entry, because the weak kind is the one that grows', () => {
    // Given a namespace cannot be fetched and a documentation link is a valid address
    // When
    const diagnostic = ALLOWED_BUNDLE_ORIGINS.filter((allowed) => allowed.kind === 'diagnostic');

    // Then
    expect(diagnostic).toHaveLength(1);
  });
});

describe('the shipped bundle', () => {
  it('should carry no address outside the origin it is served from', () => {
    // Given the built file a reader downloads, not a source file
    const bundle = SHIPPED_CLIENT_BUNDLES[0];
    if (bundle === undefined) throw new Error('no shipped bundle is configured');

    let contents: string;
    try {
      contents = readFileSync(join(repoRoot, bundle.file), 'utf8');
    } catch {
      // A MISSING BUNDLE FAILS RATHER THAN SKIPS. Nothing to read reads exactly like nothing
      // to find, which is the state this whole file exists to make impossible.
      throw new Error(`${bundle.file} is not built; run pnpm build before this suite`);
    }

    // When
    const findings = findForeignOrigins(contents);

    // Then
    expect(findings).toEqual([]);
  });
});

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { LICENSE_ATTESTATIONS } from '../../src/config';
import { buildManifestGate } from '../../src/gates/build-manifest.gate';
import { dependencyGraphGate } from '../../src/gates/dependency-graph.gate';
import { fixtureLicensesGate } from '../../src/gates/fixture-licenses.gate';
import { licensesGate } from '../../src/gates/licenses.gate';
import { detectLicenseFromText, hashLicenseText } from '../../src/lib/licenses';
import { readWorkspaceManifests, resolveShippedPackages } from '../../src/lib/workspace';
import { GATES, selectGates } from '../../src/run';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * A file planted inside `core` that imports from `vue`, which the graph forbids.
 * It is removed again in `afterEach` so the repository is restored to green.
 */
const PROBE_PATH = join(repoRoot, 'packages', 'core', 'src', 'deps-boundary.probe.ts');

const PROBE_SOURCE = `// Temporary probe written by the dependency graph gate test. Removed by the same test.
export { PACKAGE_NAME as PROBE } from '../../vue/src/index';
`;

afterEach(() => {
  rmSync(PROBE_PATH, { force: true });
});

describe('buildManifestGate', () => {
  it('should pass on the committed BUILD.md', async () => {
    // Given
    const context = { repoRoot };

    // When
    const result = await buildManifestGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
  });

  it('should run before every other gate', () => {
    // Given
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(buildManifestGate.id);

    // Then
    expect(position).toBe(0);
  });
});

describe('dependencyGraphGate', () => {
  it('should pass on the committed dependency graph', async () => {
    // Given
    const context = { repoRoot };

    // When
    const result = await dependencyGraphGate.run(context);

    // Then
    expect(result.status).toBe('pass');
  }, 180_000);

  it('should fail when core is made to depend on vue', async () => {
    // Given
    writeFileSync(PROBE_PATH, PROBE_SOURCE, 'utf8');

    // When
    const result = await dependencyGraphGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('fail');
    expect(result.findings.map((finding) => finding.message).join('\n')).toContain('boundary-core');
  }, 180_000);

  it('should return to green once the violation is removed', async () => {
    // Given
    writeFileSync(PROBE_PATH, PROBE_SOURCE, 'utf8');
    rmSync(PROBE_PATH, { force: true });

    // When
    const result = await dependencyGraphGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('pass');
  }, 180_000);
});

describe('licensesGate', () => {
  it('should pass on the committed dependency tree', async () => {
    // Given
    const context = { repoRoot };

    // When
    const result = await licensesGate.run(context);

    // Then
    const errors = result.findings.filter((finding) => finding.level === 'error');
    expect(errors).toEqual([]);
    expect(result.status).toBe('pass');
  }, 180_000);

  it('should scope the production zone to the published packages and the ones they bundle', () => {
    // Given
    const manifests = readWorkspaceManifests(repoRoot);

    // When
    const result = resolveShippedPackages(manifests);

    // Then
    expect(result.published).toEqual([
      '@openref/core',
      '@openref/nest',
      '@openref/theme',
      '@openref/vue',
      'openref',
    ]);
    expect(result.bundled).toEqual(['@openref/render', '@openref/runner', '@openref/search']);
    expect(result.shipped).not.toContain('@openref/gates');
  });

  it('should hold a recorded license reading that still matches the text on disk', () => {
    // Given
    const recorded = LICENSE_ATTESTATIONS.find(
      (attestation) => attestation.package === 'spawndamnit@3.0.1',
    );
    const path = join(
      repoRoot,
      'node_modules/.pnpm/spawndamnit@3.0.1/node_modules/spawndamnit',
      recorded?.file ?? 'LICENSE',
    );

    // When
    const actual = hashLicenseText(readFileSync(path, 'utf8'));

    // Then
    expect(recorded?.sha256).toBe(actual);
    expect(detectLicenseFromText(readFileSync(path, 'utf8'))).toBe(recorded?.license);
  });
});

describe('fixtureLicensesGate', () => {
  it('should pass on the committed corpus', async () => {
    // Given
    const context = { repoRoot };

    // When
    const result = await fixtureLicensesGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
  }, 120_000);

  it('should attribute every corpus document in the NOTICE that sits beside it', () => {
    // Given
    const base = join(repoRoot, 'packages/core/test/corpus');
    const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as {
      documents: { file: string; copyrightHolder: string; license: string }[];
    };
    const notice = readFileSync(join(base, 'NOTICE'), 'utf8');

    // When
    const missing = manifest.documents.filter(
      (document) =>
        !notice.includes(document.file) ||
        !notice.includes(document.copyrightHolder) ||
        !notice.includes(document.license),
    );

    // Then
    expect(missing.map((document) => document.file)).toEqual([]);
  });

  it('should cover 3.0, 3.1 and 3.2 with at least fifteen documents, per SPEC 21', () => {
    // Given
    const base = join(repoRoot, 'packages/core/test/corpus');
    const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as {
      documents: { file: string }[];
    };

    // When
    const versions = new Set(
      manifest.documents.map((document) => {
        const text = readFileSync(join(base, 'documents', document.file), 'utf8');
        return /openapi["']?\s*:\s*["']?(\d+\.\d+)/.exec(text)?.[1] ?? 'unknown';
      }),
    );

    // Then
    expect(manifest.documents.length).toBeGreaterThanOrEqual(15);
    expect([...versions].sort()).toEqual(['3.0', '3.1', '3.2']);
  }, 60_000);
});

describe('selectGates', () => {
  it('should return the licenses gate on its own for the release job', () => {
    // Given
    const ids = ['licenses'];

    // When
    const selected = selectGates(ids);

    // Then
    expect(selected.map((gate) => gate.id)).toEqual(['licenses']);
  });

  it('should refuse an unknown gate id rather than running nothing', () => {
    // Given
    const ids = ['licences'];

    // When
    const act = (): unknown => selectGates(ids);

    // Then
    expect(act).toThrow(/unknown gate/);
  });
});

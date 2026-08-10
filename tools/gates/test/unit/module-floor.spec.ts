import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The floor CI runs the load check on is the floor `engines` declares.
 *
 * Two places name a Node version and they mean the same thing: `engines.node` is the promise to
 * a reader, and the CI job is the only thing that tests it. If they drift, the job keeps passing
 * on a version nobody was promised anything about, which is the failure the job exists to
 * prevent, reproduced one level up.
 *
 * Checked here rather than in the script, because the script reads `engines` at runtime and so
 * cannot notice that the workflow pinned something else.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The floor as `engines.node` states it. */
function declaredFloor(): string {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    readonly engines?: { readonly node?: string };
  };
  const range = manifest.engines?.node ?? '';

  return /(\d+\.\d+\.\d+)/.exec(range)?.[1] ?? '';
}

/** Every `node-version:` the workflow pins. */
function pinnedVersions(): string[] {
  const workflow = readFileSync(resolve(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

  return [...workflow.matchAll(/node-version:\s*([\d.]+)/g)].map((match) => match[1] ?? '');
}

describe('the engines floor', () => {
  it('should be a full version rather than a range with no floor in it', () => {
    // Given
    const floor = declaredFloor();

    // Then
    expect(floor).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should be the version the floor job pins', () => {
    // Given
    const floor = declaredFloor();

    // When
    const pinned = pinnedVersions();

    // Then
    expect(pinned).toContain(floor);
  });

  it('should be checked by a job that runs the load script', () => {
    // Given
    const workflow = readFileSync(resolve(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

    // Then
    // Named rather than pattern matched: this is the one step whose absence would leave the
    // floor pinned, the job green, and nothing loaded on it.
    expect(workflow).toContain('node tools/module-floor-check.mjs');
  });
});

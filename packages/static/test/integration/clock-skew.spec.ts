import { mkdtemp, readdir, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { buildSite, BUILD_MANIFEST_FILE, FsOutputStore, type BuildReport } from '../../src/index';
import { fixtureAssets } from '../mocks/documents';

/**
 * The incremental guards of SPEC 16.3 against a clock that lies, attacked by `T043`.
 *
 * A GUARD THAT TRUSTS A MODIFICATION TIME IS A GUARD A BAD CHECKOUT CAN TURN OFF, and a checkout
 * is exactly where these files come from: `git` writes every file at clone time, a restored cache
 * writes whatever it recorded, and a container with a skewed clock writes the future. This suite
 * is the measured statement that nothing here reads one. It is written against a real directory
 * rather than the memory store because a modification time only exists on a disk.
 */

const FUTURE = new Date('2036-08-28T00:00:00Z');
const PAST = new Date('1980-01-01T00:00:00Z');

function twoOperations(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Skew', version: '1.0.0' },
    paths: {
      '/ping': { get: { operationId: 'ping', responses: { 200: { description: 'ok' } } } },
      '/pong': { get: { operationId: 'pong', responses: { 200: { description: 'ok' } } } },
    },
  });
}

describe('the incremental build against a clock that lies', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openref-skew-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** One build into the shared directory. */
  const build = async (): Promise<BuildReport> =>
    buildSite({
      document: twoOperations(),
      store: new FsOutputStore(root),
      assets: fixtureAssets(),
    });

  /** Stamps every file of the output with one time. */
  const stampAll = async (when: Date): Promise<number> => {
    const stamped: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else {
          await utimes(path, when, when);
          stamped.push(path);
        }
      }
    };
    await walk(root);
    return stamped.length;
  };

  it.each([
    ['ten years in the future', FUTURE],
    ['decades in the past', PAST],
  ])('should carry the same pages when every file is dated %s', async (_when, date) => {
    // Given a complete build, and then a clock nobody can trust.
    await build();
    const stamped = await stampAll(date);

    // Then, before the assertion: the stamp really did land.
    expect(stamped).toBeGreaterThan(5);
    const manifestTime = (await stat(join(root, BUILD_MANIFEST_FILE))).mtime.getFullYear();
    expect(manifestTime).toBe(date.getFullYear());

    // When
    const report = await build();

    // Then: the decision is the content's, not the clock's.
    expect(report.rendered).toEqual([]);
    expect(report.carried.length).toBeGreaterThan(0);
  });

  it('should carry the same pages when the pages are newer than the manifest that describes them', async () => {
    // Given: the ordering a guard reading modification times would have believed in.
    await build();
    await stampAll(FUTURE);
    await utimes(join(root, BUILD_MANIFEST_FILE), PAST, PAST);

    // When
    const report = await build();

    // Then
    expect(report.rendered).toEqual([]);
    expect(report.carried.length).toBeGreaterThan(0);
  });

  it('should still render a page whose content moved, whatever the clock says', async () => {
    // Given: the other direction, so the suite is not measuring a build that carries everything.
    await build();
    await stampAll(FUTURE);

    // When
    const report = await buildSite({
      document: normalizeOpenApiDocument({
        openapi: '3.1.0',
        info: { title: 'Skew', version: '1.0.0' },
        paths: {
          '/ping': { get: { operationId: 'ping', responses: { 200: { description: 'ok' } } } },
          '/pong': {
            get: {
              operationId: 'pong',
              summary: 'Moved',
              responses: { 200: { description: 'ok' } },
            },
          },
        },
      }),
      store: new FsOutputStore(root),
      assets: fixtureAssets(),
    });

    // Then
    expect(report.rendered).toContain('get-pong/index.html');
  });
});

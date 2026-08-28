import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseFoldForFilesystem, normalizeOpenApiDocument } from '@openref/core';
import { buildSite, FsOutputStore } from '../../src/index';
import { fixtureAssets } from '../mocks/documents';

/**
 * The fold of SPEC 16.1, held against the filesystem it is about.
 *
 * IN MEMORY THIS SUITE WOULD PROVE NOTHING. The question is whether two names are one entry, and
 * only a real volume answers it; two earlier spellings of this guard passed their own unit tests
 * and lost a page on disk. So each pair is written to a temporary directory first and the volume
 * is asked, and only then is the build's answer compared with the volume's.
 *
 * BOTH DIRECTIONS, because the two failures are opposite. A fold that is too weak loses a page in
 * silence; one that is too strong refuses a document that would have been fine. The first is the
 * one that must never happen, and SPEC 16.1 records why the second is the error to have.
 */
describe('the page fold against a real volume', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openref-fold-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Whether this volume stores the two names as one entry. */
  async function volumeFolds(left: string, right: string): Promise<boolean> {
    const directory = await mkdtemp(join(root, 'probe-'));
    await writeFile(join(directory, `${left}.t`), 'LEFT', 'utf8');
    await writeFile(join(directory, `${right}.t`), 'RIGHT', 'utf8');
    const entries = await readdir(directory);

    return entries.length === 1;
  }

  /** A document with two schemas under the given ids. */
  const twoSchemas = (left: string, right: string): ReturnType<typeof normalizeOpenApiDocument> =>
    normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Fold', version: '1.0.0' },
      paths: { '/a': { get: { operationId: 'a', responses: { 200: { description: 'ok' } } } } },
      components: { schemas: { [left]: { type: 'object' }, [right]: { type: 'object' } } },
    });

  /** Builds the pair, answering whether the build accepted it. */
  async function builds(left: string, right: string): Promise<boolean> {
    const out = await mkdtemp(join(root, 'out-'));
    try {
      await buildSite({
        document: twoSchemas(left, right),
        store: new FsOutputStore(out),
        assets: fixtureAssets(),
      });
      return true;
    } catch {
      return false;
    }
  }

  it.each([
    ['the capital sharp s, whose upper case is itself', 'ss', 'ẞ'],
    ['the small sharp s', 'ss', 'ß'],
    ['the two sharp s spellings', 'ß', 'ẞ'],
    ['the long s', 'sample', 'ſample'],
    ['a ligature', 'fi', 'ﬁ'],
    ['the Kelvin sign', 'k', 'K'],
  ])('should refuse a pair this volume stores as one entry: %s', async (_name, left, right) => {
    // Then, before the build: the volume really does fold them, so a build that wrote both
    // would leave one file holding one of the two documents.
    expect(await volumeFolds(left, right)).toBe(true);
    expect(caseFoldForFilesystem(left)).toBe(caseFoldForFilesystem(right));

    // When
    const accepted = await builds(left, right);

    // Then
    expect(accepted).toBe(false);
  });

  it.each([
    ['the dotless i, whose upper case is I', 'i', 'ı'],
    ['the dotted capital I', 'i', 'İ'],
    ['a diaeresis', 'a', 'ä'],
    ['a Greek letter', 'omega', 'Ω'],
    ['a final sigma', 'sigma', 'ς'],
  ])('should build a pair this volume keeps apart: %s', async (_name, left, right) => {
    // Then, before the build: the volume really does keep them apart.
    expect(await volumeFolds(left, right)).toBe(false);
    expect(caseFoldForFilesystem(left)).not.toBe(caseFoldForFilesystem(right));

    // When
    const accepted = await builds(left, right);

    // Then
    expect(accepted).toBe(true);
  });
});

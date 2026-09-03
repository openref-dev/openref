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
 *
 * WHOSE PROPERTY EACH ASSERTION IS, SEPARATED 2026-09-03 BECAUSE ext4 SEPARATED IT. The first
 * edition asked the volume as a precondition of every case, and so wrote "this volume folds case"
 * where it meant "the product folds case". On APFS both read alike and the suite was green for two
 * milestones; on the runner's ext4 the six folding cases failed on the precondition alone, with
 * `caseFoldForFilesystem` answering correctly throughout. That is the direction SPEC 16.1 chooses
 * in as many words: where a volume folds less than Unicode, a legal document is refused, and a
 * case-sensitive volume is that case taken to its limit. So the fold and the build's refusal are
 * asserted on every platform, since they are facts about the product and hold wherever it runs,
 * and the comparison with the volume is one case of its own that says when it cannot be taken.
 *
 * THE VACUOUS HALF IS WHY THAT COMPARISON IS ONE CASE AND NOT ELEVEN. `keeps them apart` was the
 * half that did not go red on ext4, because a case-sensitive volume keeps every pair apart and the
 * precondition passed for the wrong reason on all five. A suite where one half fails honestly and
 * the other passes vacuously is worse than one that fails twice, and the same probe now decides
 * both.
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

  /** The pairs the fold puts together, so the build must refuse the document carrying both. */
  const FOLDED: readonly (readonly [string, string, string])[] = [
    ['the capital sharp s, whose upper case is itself', 'ss', 'ẞ'],
    ['the small sharp s', 'ss', 'ß'],
    ['the two sharp s spellings', 'ß', 'ẞ'],
    ['the long s', 'sample', 'ſample'],
    ['a ligature', 'fi', 'ﬁ'],
    ['the Kelvin sign', 'k', 'K'],
  ];

  /** The pairs the fold keeps apart, so the build must accept the document carrying both. */
  const DISTINCT: readonly (readonly [string, string, string])[] = [
    ['the dotless i, whose upper case is I', 'i', 'ı'],
    ['the dotted capital I', 'i', 'İ'],
    ['a diaeresis', 'a', 'ä'],
    ['a Greek letter', 'omega', 'Ω'],
    ['a final sigma', 'sigma', 'ς'],
  ];

  it.each(FOLDED)('should refuse a pair the fold puts together: %s', async (_name, left, right) => {
    // Then, before the build: the fold really does put them together, so a build that wrote
    // both would leave one file holding one of the two documents on a volume that folds case.
    expect(caseFoldForFilesystem(left)).toBe(caseFoldForFilesystem(right));

    // When
    const accepted = await builds(left, right);

    // Then
    expect(accepted).toBe(false);
  });

  it.each(DISTINCT)('should build a pair the fold keeps apart: %s', async (_name, left, right) => {
    // Then, before the build: the fold really does keep them apart.
    expect(caseFoldForFilesystem(left)).not.toBe(caseFoldForFilesystem(right));

    // When
    const accepted = await builds(left, right);

    // Then
    expect(accepted).toBe(true);
  });

  it('should agree with this volume on every pair, or say the volume cannot be asked', async ({
    skip,
  }) => {
    // Given: whether this volume folds case at all, measured on the plainest pair there is
    // rather than assumed from the name of the platform. A machine can mount either kind.
    const foldsCase = await volumeFolds('a', 'A');

    // A check that cannot run says so and never passes silently: on a case-sensitive volume
    // every pair is two entries, so this comparison would agree with nothing and read green.
    // The volume is the subject here, and a case-sensitive one is not the subject SPEC 16.1
    // is about. Mounting a case-insensitive volume is not something a checkout can do, so on
    // such a machine this is the one thing in the suite that goes unmeasured, by name.
    if (!foldsCase) {
      skip(
        'this volume is case sensitive, so it cannot answer whether two names are one entry. ' +
          'The fold and the build refusal were checked above and hold on every platform; only ' +
          'the comparison with a case insensitive volume was not taken, and it needs one mounted.',
      );
      return;
    }

    // When, Then: on the volume this rule is about, the fold and the volume answer alike on
    // all eleven pairs. SPEC 16.1: a divergence with the volume is a failing test here, which
    // is the whole reason the pairs are held in both directions rather than in one.
    for (const [name, left, right] of [...FOLDED, ...DISTINCT]) {
      expect(await volumeFolds(left, right), `${name}: ${left} and ${right} on this volume`).toBe(
        caseFoldForFilesystem(left) === caseFoldForFilesystem(right),
      );
    }
  });
});

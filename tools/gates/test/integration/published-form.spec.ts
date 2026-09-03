/**
 * The published figures SPEC 20 records, taken off this tree rather than restated from it.
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT ONE. It reads what `pnpm build` produced, and the
 * convention this repository already follows is that a unit test never needs a build: the sibling
 * unit file pins the derivation, the declaration and the three branches, all of them from constants
 * and synthetic trees. What no unit test can do is notice that the artefact moved, and the review
 * of 2026-08-31 found exactly that gap: every published figure in the entry was a literal, so a
 * drift in the bundle would leave the recorded arithmetic describing an artefact that no longer
 * exists, which is the class SPEC 0 calls a rule with no runner.
 *
 * WHAT GOES RED HERE. Any change to the shipped stylesheets or the first paint bundle that moves
 * the published byte counts, and any change to the digest length or the rewrite that moves the cost
 * per reference. The cap is not re-derived here; that is the maintainer's, and the entry says so.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIGEST_LENGTH } from '@openref/render';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_JS_ENTRY, SIZE_BUDGETS, THEME_CSS_ROOTS } from '../../src/config';
import { collectBudgetOutcomes } from '../../src/lib/budget-report';
import { formatBytes } from '../../src/lib/budgets';
import { forgetPublishedForm, readPublishedForm } from '../../src/lib/published-form';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The six files the first paint compiles, in the order the entry names them.
 *
 * SIX OF THESE NAMES MOVED AND A SEVENTH FILE APPEARED AT `TX-SOCKET-CONSOLE`, and the reason is
 * the same mechanism one level down. A chunk's name is its content digest, so one more deferred
 * entry point changes which modules each initial chunk holds and every name with it, and the
 * region the notice kinds live in became a chunk of its own because the set of entry points that
 * reach it changed. The names are re-read here rather than kept; the figures below are what the
 * file is about.
 *
 * ONE OF THESE NAMES MOVED ON 2026-09-03 AND ITS SIZE MOVED WITH IT, which is the other case and
 * the reason both are written down. `chunk-3BFRF6WF` became `chunk-FMGVZQY6` and grew from 1,093 to
 * 1,418 bytes, because `T065` put `nodeSegmentOf` and the twenty one names a mount claims into
 * `links.ts`, which that chunk holds. The list ships by necessity: a served page carries node ids
 * and the browser builds the link, so a rule the bundle does not have is a theme linking to an
 * address the server does not serve. SPEC 20 records the arrival and the cap did not move.
 *
 * TWO OF THESE NAMES MOVED ON 2026-09-02 AND NOT ONE OF THE SIZES DID. A chunk's name is its
 * content digest, so renaming a published constant moves it and every chunk that imports it:
 * `chunk-TEAI3FZD` became `chunk-5LRQ4D6P` when `@openref/vue`'s `DEFAULT_THEME_NAME` became
 * `FALLBACK_THEME_NAME`, and `chunk-KW7NTLUC` became `chunk-BV3VPU5E` because it imports the
 * first. Both weigh exactly what they weighed, and so does the total, which is the property the
 * figures below are actually about.
 */
const INITIAL = [
  'openref.js',
  'chunk-EJ4XQ22A.js',
  'chunk-FMGVZQY6.js',
  'chunk-IF2D2VIE.js',
  'chunk-GKCAFBE4.js',
  'chunk-FYRWH3QL.js',
  'chunk-MPK3G3AA.js',
] as const;

/** The three stylesheets of the default theme, by the name the catalog keys them under. */
const STYLESHEETS = ['fonts.css', 'tokens.css', 'theme.css'] as const;

describe('the published form of this tree', () => {
  let published: ReadonlyMap<string, Uint8Array>;

  beforeAll(() => {
    forgetPublishedForm();
    published = readPublishedForm(REPO_ROOT);
  });

  const sizeOf = (name: string): number => {
    const bytes = published.get(name);
    if (bytes === undefined) throw new Error(`the catalog has no asset named ${name}`);

    return bytes.byteLength;
  };

  it('should hold every file the two moved rows are about, before anything is measured', () => {
    // Given the two subjects named by the configuration rather than by this file
    // Then
    expect(THEME_CSS_ROOTS).toEqual(['packages/theme/dist', 'packages/theme/fonts']);
    expect(CLIENT_JS_ENTRY).toBe('packages/nest/dist/browser/openref.js');
    for (const name of [...STYLESHEETS, ...INITIAL]) expect(published.has(name)).toBe(true);
  });

  it('should weigh the three stylesheets at the figure SPEC 20 re-derived the cap from', () => {
    // Given
    // When
    const total = STYLESHEETS.reduce((sum, name) => sum + sizeOf(name), 0);

    // Then
    expect(total).toBe(62_594);
    expect(sizeOf('theme.css')).toBe(48_506);
    expect(sizeOf('tokens.css')).toBe(9_707);
    expect(sizeOf('fonts.css')).toBe(4_381);
  });

  it('should weigh the six initial files at the figure the JS property was re-checked with', () => {
    // Given
    // When
    const total = INITIAL.reduce((sum, name) => sum + sizeOf(name), 0);

    // Then, the figure after `T065`'s node segment escape, 325 bytes over the 111,826 the row
    // carried after the socket console arrived, which was itself 1,267 over the 110,559 before it.
    // The cap did not move for either: 112,151 still fits under 110 KB and `sign-in-return`
    // returning to the first load still fails the budget, which is the property SPEC 20 states.
    expect(total).toBe(112_151);
    expect(total - 111_826).toBe(325);
    expect(111_826 - 110_559).toBe(1_267);
    expect(sizeOf('openref.js')).toBe(20_787);
    expect(sizeOf('chunk-IF2D2VIE.js')).toBe(5_089);
    expect(sizeOf('chunk-MPK3G3AA.js')).toBe(656);
  });

  it('should account for every byte of both deltas as a rewritten reference', () => {
    // Given the files on disk, which is the form the caps used to be taken on
    const onDisk = (relativePath: string): number =>
      readFileSync(join(REPO_ROOT, relativePath)).byteLength;
    const browser = 'packages/nest/dist/browser';

    // When
    const cssDelta = sizeOf('fonts.css') - onDisk('packages/theme/fonts/fonts.css');
    const jsDelta = INITIAL.reduce(
      (sum, name) => sum + sizeOf(name) - onDisk(`${browser}/${name}`),
      0,
    );

    // Then, a dot and the digest, ten times over on one side and fifteen on the other
    expect(DIGEST_LENGTH + 1).toBe(17);
    expect(cssDelta).toBe(10 * (DIGEST_LENGTH + 1));
    expect(jsDelta).toBe(19 * (DIGEST_LENGTH + 1));
    expect(onDisk('packages/theme/dist/styles/theme.css')).toBe(sizeOf('theme.css'));
    expect(onDisk('packages/theme/dist/styles/tokens.css')).toBe(sizeOf('tokens.css'));
  });

  it('should weigh the cheapest deferred gesture at what the JS property is checked with', () => {
    // Given the two files a return from an authorization server downloads
    // When
    const total = sizeOf('oauth-landing-VRHHK533.js') + sizeOf('chunk-FI2DNV2T.js');

    // Then
    expect(total).toBe(1_468);
  });

  it('should be what the budgets gate actually reports for the two moved rows', () => {
    // Given the gate reading this tree with nothing injected, which is the run CI makes
    const report = collectBudgetOutcomes(REPO_ROOT);
    const messageOf = (id: string): string =>
      report.outcomes.find((outcome) => outcome.id === id)?.message ?? '';

    // Then, the published totals rather than the 62,424 and 110,284 the disk holds
    expect(messageOf('theme-css-raw')).toContain(`${formatBytes(62_594)} raw`);
    expect(messageOf('client-js-raw')).toContain(`${formatBytes(112_151)} raw`);
    expect(report.errors).toEqual([]);
  });

  it('should leave the caps where the two derivations put them', () => {
    // Given, so that a moved artefact and a moved cap cannot be confused for one another
    const capOf = (id: string): number =>
      SIZE_BUDGETS.find((budget) => budget.id === id)?.limitBytes ?? 0;

    // Then
    expect(capOf('theme-css-raw')).toBe(62 * 1024);
    expect(capOf('client-js-raw')).toBe(110 * 1024);
    expect(capOf('theme-css-raw') - 62_594).toBe(894);
    // 33 SINCE 2026-09-02 AND IT WAS 53, AND THE TWENTY BYTES ARE NAMED RATHER THAN ABSORBED.
    // `T065` made `ElementTooLargeError` extend `StreamError` with an `ErrorCode`, because it is
    // the one error class any of the three published runtime packages exports and it was the one
    // breaking the rule STANDARDS and `CLAUDE.md` both state. Obeying the rule costs the subclass
    // plumbing in the first paint closure. Measured by building the tree twice, with and without
    // that one change: 110,539 against 110,559. THE CAP DID NOT MOVE and is asserted above.
    // 489 SINCE `T065`'s NODE SEGMENT ESCAPE, 814 SINCE `TX-SOCKET-CONSOLE`, AND 33 BEFORE THAT.
    // The console was a capability arriving rather than an artefact growing, 1,267 bytes; the
    // escape is 325, the twenty one names a mount claims and the rule that reads them, which ship
    // because a served page carries node ids and the browser builds the link. The cap did not move
    // for either and is asserted above.
    //
    // THE HEADROOM IS TAKEN OFF THE MEASUREMENT AND NOT OFF A COPY OF IT. This line read
    // `capOf('client-js-raw') - 111_826` for one round after the artefact weighed 112,151, which is
    // arithmetic on two stale literals in the file whose own header calls a literal describing a
    // vanished artefact the class it exists to prevent. Both operands are now read from the tree.
    const initial = INITIAL.reduce((sum, name) => sum + sizeOf(name), 0);
    const signInReturn = sizeOf('oauth-landing-VRHHK533.js') + sizeOf('chunk-FI2DNV2T.js');

    expect(capOf('client-js-raw') - initial).toBe(489);

    // AND THE PROPERTY THE CAP IS DERIVED BY, CHECKED THE SAME WAY: the smallest whole KB step the
    // artefact fits under, at which the cheapest deferred gesture returning to the first load still
    // fails. Every figure here is measured, so this cannot go stale without going red.
    expect(initial).toBeLessThanOrEqual(capOf('client-js-raw'));
    expect(109 * 1024).toBeLessThan(initial);
    expect(initial + signInReturn).toBeGreaterThan(capOf('client-js-raw'));

    expect(capOf('theme-entry-raw')).toBe(281 * 1024);
  });
});

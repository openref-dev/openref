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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DIGEST_LENGTH } from '@openref/render';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_JS_ENTRY, SIZE_BUDGETS, THEME_CSS_ROOTS } from '../../src/config';
import { collectBudgetOutcomes } from '../../src/lib/budget-report';
import type { BudgetOutcome } from '../../src/lib/budget-report';
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
 * THAT SAME NAME MOVED AGAIN ON 2026-09-03 AND ITS SIZE STILL DID NOT. `chunk-CRGLGLGA` became
 * `chunk-DC7HAQCY` when the operation article began stating the refusal of a language that could
 * not write the request, so a reader can tell a vanished tab from a language the page never had.
 * Same mechanism, same 5,089 bytes, and the whole of the change is again in `openref.js`.
 *
 * ONE OF THESE NAMES MOVED ON 2026-09-03 AND ITS SIZE DID NOT, which is the plain form of the
 * mechanism. `chunk-IF2D2VIE` became `chunk-CRGLGLGA` when the operation article gained the
 * sentence naming the three SPEC 18 languages the page does not draw: the chunk imports the module
 * that changed, so its digest moved while its content did not, and it weighs 5,089 bytes either
 * way. Every byte of that change is in `openref.js`, and the figure below says how many.
 *
 * TWO OF THESE NAMES MOVED ON 2026-09-04 AND NEITHER SIZE DID, WHICH IS THE PLAIN MECHANISM AGAIN.
 * `chunk-DC7HAQCY` became `chunk-Q4YE3IPE` and `chunk-FYRWH3QL` became `chunk-TBC2TEML` when the
 * operation article gained the third sentence under the tabs, the one saying what is true of the
 * samples it did draw. Both weigh exactly what they weighed, 5,089 and 2,352, and the whole of the
 * change is again in `openref.js`.
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
  'chunk-Q4YE3IPE.js',
  'chunk-GKCAFBE4.js',
  'chunk-TBC2TEML.js',
  'chunk-MPK3G3AA.js',
] as const;

/** The telltale themed entry, which is a second served reference and a second published form. */
const THEME_ENTRY = 'packages/theme-telltale/dist/entry/entry.js';

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

    // Then, the figure this tree publishes, after the third sentence under the tabs arrived.
    //
    // 57 BYTES ON 2026-09-04, AND THEY PUT ON THE PAGE TWO RESULTS THE GENERATOR HAD ALWAYS
    // COMPUTED AND THE TRANSFORM HAD ALWAYS THROWN AWAY. Measured by building the tree twice, with
    // the sentence and without it: 112,644 against 112,587. `GeneratedSamples.notes` carries the
    // redirect divergence of cURL, HTTPie, PowerShell and Swift and reached no reader;
    // `PlaceholderCredentials.unsendable` carries the schemes no request can hold a credential for,
    // so a mutualTLS operation drew twelve samples that cannot authenticate with nothing said.
    // THE CAP DID NOT MOVE AND THE ROW IS FOUR BYTES OVER IT, asserted below. That is reported red
    // rather than paid for out of somewhere else: the cap is the maintainer's.
    //
    // 26 BYTES ON 2026-09-03, AND THEY BUY A MARKUP CORRECTION RATHER THAN A CAPABILITY. Measured
    // by building the tree twice, with the move and without it: 112,587 against 112,561. Both
    // sentences used to render as siblings after the slot's own closing tag, so a reader met them
    // outside the section the heading opened, and an operation whose every language refused
    // mounted an empty `role="tablist"` under that heading. The element the three now share is
    // `NodePanel`'s and the strip is drawn only when there is a tab to put in it. THE CAP DID NOT
    // MOVE and the headroom is 53 bytes, asserted below.
    //
    // THE DELTA CHAIN THAT STOOD HERE WAS ARITHMETIC OVER A MEASUREMENT AND A LITERAL PRIOR, AND
    // IT IS RECORDED RATHER THAN ASSERTED NOW. `expect(total - 112_151).toBe(229)` could not fail
    // unless the line above it failed first, and `expect(112_151 - 111_826).toBe(325)` could not
    // fail at all: each prior belongs to a tree that no longer exists, so the pair held a number
    // and not a fact, which is the class this file's own header exists to prevent. Every one of
    // them was measured the way SPEC 20 requires of an arrival, by building the tree twice with
    // the change and without it, and that is what they are written down as: 112,644 is 57 over the
    // 112,587 left by the samples section element moving into `NodePanel`, which was 26 over the
    // 112,561 the row carried once the page stated a refusal, itself 181 over the 112,380 left by
    // the page naming the three languages it does not draw, which was 229 over the 112,151 left by
    // `T065`'s node segment escape, itself 325 over the 111,826 left by the socket console, itself
    // 1,267 over 110,559. The cap did not move for any of them, this one included.
    expect(total).toBe(112_644);

    // AND ALL 57 ARE IN THE ENTRY, WHICH IS DERIVED HERE RATHER THAN RESTATED, exactly as the 26
    // and the 181 before them were. The six files beside the entry weighed 91,364 before the change
    // and weigh 91,364 after it, both operands off this tree, so the entry is where the whole of
    // the change went; two chunk names moved and neither size did.
    expect(sizeOf('openref.js')).toBe(21_280);
    expect(total - sizeOf('openref.js')).toBe(91_364);
    expect(sizeOf('chunk-Q4YE3IPE.js')).toBe(5_089);
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
    const outcomeOf = (id: string): BudgetOutcome | undefined =>
      report.outcomes.find((outcome) => outcome.id === id);
    const messageOf = (id: string): string => outcomeOf(id)?.message ?? '';
    const initial = INITIAL.reduce((sum, name) => sum + sizeOf(name), 0);
    const stylesheets = STYLESHEETS.reduce((sum, name) => sum + sizeOf(name), 0);
    const cap = (id: string): number =>
      SIZE_BUDGETS.find((budget) => budget.id === id)?.limitBytes ?? 0;

    // Then, the published totals rather than the 62,424 and 112,321 the disk holds. BOTH OPERANDS
    // ARE READ OFF THIS TREE, AND THE LITERAL THAT STOOD HERE COULD NOT FAIL ON ITS OWN SUBJECT:
    // it read `formatBytes(112_561)`, and `formatBytes` divides by 1024 and fixes one decimal, so
    // it carries about 102 bytes of resolution. 112,561 and 112,587 render as the same string, the
    // literal was already 26 bytes stale when it was written, and no drift of less than a tenth of
    // a kilobyte could ever have reddened it. That is this project's own tenth class, a check whose
    // method cannot see the thing it is checking.
    expect(messageOf('theme-css-raw')).toContain(`${formatBytes(stylesheets)} raw`);
    expect(messageOf('client-js-raw')).toContain(`${formatBytes(initial)} raw`);

    // AND THE SUBJECT THE FORMATTED STRING CANNOT CARRY, WHICH IS THE VERDICT AND IT IS IN BYTES.
    // The gate compares the published artefact against the cap byte for byte, so its status is a
    // statement no rounding smears: on this tree the published form is 323 bytes of rewritten
    // reference heavier than the disk, and those 323 bytes are the whole difference between a row
    // that fits and a row that does not. A gate that weighed the disk here would say `pass`.
    expect(outcomeOf('client-js-raw')?.status).toBe(initial > cap('client-js-raw') ? 'over' : 'ok');
    expect(outcomeOf('theme-css-raw')?.status).toBe(
      stylesheets > cap('theme-css-raw') ? 'over' : 'ok',
    );
    expect(report.errors).toEqual([]);
  });

  it('should weigh the telltale entry at the figures SPEC 20 records for its two rows', () => {
    // Given the second served reference, which had no case of any kind until 2026-09-04 and whose
    // two rows had therefore drifted from SPEC 20 unnoticed: the raw row recorded 260,847 and the
    // tree held 261,932, and the gzip row recorded 96,355 against 96,816. Every first paint arrival
    // of a slice lands in this directory by construction, because it carries a chunk per gesture,
    // and none of them had been recorded against it.
    forgetPublishedForm();
    const themed = readPublishedForm(REPO_ROOT, THEME_ENTRY);
    const entryDir = join(REPO_ROOT, 'packages', 'theme-telltale', 'dist', 'entry');

    // When, each row weighed the way its own budget declares: the raw row on disk and the gzip row
    // on the published form, which is why the two figures are not two readings of one number
    const onDisk = readdirSync(entryDir)
      .filter((name) => name.endsWith('.js'))
      .reduce((sum, name) => sum + statSync(join(entryDir, name)).size, 0);
    const gzip = [...themed]
      .filter(([name]) => name.endsWith('.js'))
      .reduce((sum, [, bytes]) => sum + gzipSync(bytes).byteLength, 0);

    // Then, the figures this tree holds, with the arrival of this slice named: 77 raw bytes and 22
    // gzip, which is the same sentence under the tabs the row above paid 57 for, arriving in a
    // second bundle because a themed entry carries the renderer too.
    expect(onDisk).toBe(262_009);
    expect(gzip).toBe(96_838);

    // And the headroom each row actually has, against caps neither of which moved
    expect(281 * 1024 - onDisk).toBe(25_735);
    expect(97 * 1024 - gzip).toBe(2_490);
  });

  it('should leave the caps where the two derivations put them', () => {
    // Given, so that a moved artefact and a moved cap cannot be confused for one another
    const capOf = (id: string): number =>
      SIZE_BUDGETS.find((budget) => budget.id === id)?.limitBytes ?? 0;

    // Then
    expect(capOf('theme-css-raw')).toBe(62 * 1024);
    expect(capOf('client-js-raw')).toBe(111 * 1024);
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

    // FOUR BYTES OVER ON 2026-09-04, REPORTED RED RATHER THAN PAID FOR, AND THEN RULED ON. The third
    // sentence under the tabs delivers two results the generator had always computed and the
    // transform had always discarded, and it costs 57 raw bytes of the first paint against 53 of
    // headroom. The slice that spent them did not move the cap, raided no other row for the
    // difference and trimmed no part of the fix to fit: a page that silently drops what it worked
    // out is the defect that slice was about, and shrinking the sentence to buy four bytes would be
    // the same trade one layer down. The maintainer then ruled the cap to 111 KB by this row's own
    // recorded property, which is the smallest whole KB step the artefact fits under at which the
    // cheapest deferred gesture returning to the first load still fails: 113,664 holds 112,644 with
    // 1,020, 112,644 plus the published 1,468 is 114,112 and fails it, and 112 KB at 114,688 would
    // not, so 111 is the one step available. Both halves are asserted below off this tree.
    //
    // 53 SINCE 2026-09-03 AND IT WAS 79, AND THE 26 ARE NAMED RATHER THAN ABSORBED. The samples
    // section element moved out of the `CodeSample` position and into `NodePanel`, so the two
    // sentences it draws stand inside the block they are about rather than after its closing tag,
    // and the tab strip is drawn only where there is a tab to put in it. THE CAP DID NOT MOVE and
    // 53 bytes was what was left of it.
    //
    // 79 SINCE 2026-09-03 AND IT WAS 260, AND THE 181 WERE NAMED RATHER THAN ABSORBED. The
    // operation page now states the refusal of a language whose emitter could not write this
    // request, so a vanished tab is told apart from a language the reference never had, which is
    // the same guarantee the sentence below it makes for the three the page holds back. The bytes
    // reach the first paint because the samples section is the one part of the article that fails
    // the adoption question of SPEC 12: its tab is client state, so the whole section is composed
    // in the browser.
    //
    // 260 SINCE 2026-09-03 AND IT WAS 489, AND THE 229 WERE NAMED THE SAME WAY. The operation page
    // began naming the three SPEC 18 languages it does not draw, so a reader can tell a language
    // this reference does not have from one it can produce.
    expect(capOf('client-js-raw') - initial).toBe(1_020);

    // AND THE PROPERTY THE CAP IS DERIVED BY, CHECKED THE SAME WAY: the smallest whole KB step the
    // artefact fits under, at which the cheapest deferred gesture returning to the first load still
    // fails. Every figure here is measured, so this cannot go stale without going red. BOTH HALVES
    // HOLD AGAIN AFTER THE RULING, and the two neighbouring steps are asserted unavailable so that
    // the cap reads as the one the property picks rather than as one of several that would fit.
    expect(initial).toBeLessThanOrEqual(capOf('client-js-raw'));
    expect(110 * 1024).toBeLessThan(initial);
    expect(initial + signInReturn).toBeGreaterThan(capOf('client-js-raw'));
    expect(initial + signInReturn).toBeLessThanOrEqual(112 * 1024);

    expect(capOf('theme-entry-raw')).toBe(281 * 1024);
  });
});

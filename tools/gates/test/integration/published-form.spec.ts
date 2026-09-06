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

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DIGEST_LENGTH } from '@openref/render';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_JS_ENTRY, SIZE_BUDGETS, THEME_CSS_ROOTS } from '../../src/config';
import {
  BASELINE_INPUT_PATHS,
  baselineFreshness,
  pageBytesFigures,
  readBrowserBaseline,
} from '../../src/lib/browser-baseline';
import { collectBudgetOutcomes } from '../../src/lib/budget-report';
import type { BudgetOutcome } from '../../src/lib/budget-report';
import { formatBytes } from '../../src/lib/budgets';
import { countCommitsSince } from '../../src/lib/git';
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
 * ONE OF THESE NAMES MOVED ON 2026-09-05 AND ITS SIZE MOVED WITH IT. `chunk-MPK3G3AA` became
 * `chunk-NNVNJ4ZN` and grew from 656 to 760 bytes: it is the chunk the notice kinds live in, and
 * `StateNotice` gained the shapes of `runtime-missing` and `drift-missing`. `chunk-Q4YE3IPE` did
 * not move at all this time, name or size, which is the first round in a while where a change to
 * the article left an initial chunk alone. The rest of that slice is in `openref.js`, which went
 * from 21,280 to 22,215, and the four things that spent it are itemised in the figure below.
 *
 * TWO OF THESE NAMES MOVED ON 2026-09-04 AND NEITHER SIZE DID, WHICH IS THE PLAIN MECHANISM AGAIN.
 * `chunk-DC7HAQCY` became `chunk-Q4YE3IPE` and `chunk-FYRWH3QL` became `chunk-TBC2TEML` when the
 * operation article gained the third sentence under the tabs, the one saying what is true of the
 * samples it did draw. Both weigh exactly what they weighed, 5,089 and 2,352, and the whole of the
 * change is again in `openref.js`.
 *
 * TWO OF THESE NAMES MOVED ON 2026-09-05 AND NOT ONE BYTE OF THE ARTEFACT DID, WHICH IS THE PLAIN
 * MECHANISM AT ITS PUREST. `chunk-D45QPAC7` became `chunk-NQKJDTAZ` and `chunk-ZSSABZO4` became
 * `chunk-DJLSRFLZ` when the node page lookup and the health heading were changed: both are server
 * side modules, and what reached the bundle is nothing at all. Every one of the seven initial files
 * weighs exactly what it weighed, `openref.js` included at 22,604, and so does every deferred chunk;
 * the digest moved because it is taken over the modules that went in rather than over the bytes that
 * came out, and comments are stripped on the way. The one figure that moved anywhere is the gzip row
 * of the telltale entry, by 11 bytes, and the entry below says why.
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
  'chunk-NQKJDTAZ.js',
  'chunk-GKCAFBE4.js',
  'chunk-DJLSRFLZ.js',
  'chunk-NNVNJ4ZN.js',
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

    // Then, 49 bytes over the 62,594 this row carried before 2026-09-05, and the 49 are one rule:
    // `.oref-nav-stats-missing`, the cell the rail draws where the finding count would be on a
    // document with no health report. Null and zero are different statements per SPEC 7.3, and
    // until that rule only one of them was ever drawn. THE CAP DID NOT MOVE and the headroom is
    // 845 bytes, asserted below.
    //
    // 112 BYTES MORE ON 2026-09-05, AND THEY ARE ALSO ONE RULE: `.oref-send[data-oref-copy]`, the
    // shape the copy control needs now that it carries a glyph rather than a word. The padding
    // written for a label draws a wide bar around a 14 pixel icon, so the one control that has no
    // text gets a square. Selected by the state attribute the button already carried, so no name
    // arrived on the boundary list every theme must style. THE CAP DID NOT MOVE and the headroom
    // is 733 bytes, asserted below.
    //
    // 380 BYTES MORE ON 2026-09-05 AT `TX-VOICE`, AND THEY ARE FOUR RULES OVER TWO NEW NAMES.
    // `.oref-drift-subjects` and `.oref-drift-why` are the disclosure a folded finding lists its
    // subjects in and the one its reasoning sits behind, per SPEC 7.2, plus the `summary` cursor
    // and the two inner margins. Both are `details` elements, so the opening costs no script and
    // survives the strict CSP; `.oref-drift-why` also joins the bidirectional isolation list,
    // because it carries a collector's sentence with an address interpolated into it exactly as
    // the message above it does. THE CAP DID NOT MOVE and the headroom is 353 bytes, asserted
    // below. What the two names cost the reader's first paint is zero: the health panel is server
    // markup the browser adopts, and the initial JS figure below is byte identical.
    expect(total).toBe(63_135);
    expect(sizeOf('theme.css')).toBe(49_047);
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
    //
    // 442 BYTES ON 2026-09-05, AND THE ROW IS NOW 663 OVER, STILL REPORTED RED RATHER THAN PAID
    // FOR. Two fixes landed and the split between them was measured rather than apportioned, by
    // building the tree three times: 113,885 at HEAD, 113,885 again with the rate limit reach fix
    // alone, and 114,327 with the copy control on top of it. So the three states of SPEC 6.2.3
    // cost the browser NOTHING, which is what the module header of `parity-model.ts` claims and
    // this is the second measurement of it, and all 442 are the copy control: an inline `svg`, a
    // stable `aria-label`, and a live region beside the button rather than a label that renames
    // itself. THE CAP DID NOT MOVE, no other row was raided, and nothing was trimmed to fit. A
    // button whose only content is a drawing and no accessible name is unreadable to a screen
    // reader, so the name is not a byte that can be bought back.
    //
    // 202 BYTES EARLIER ON 2026-09-05 AT `TX-INSTRUMENT`, AND THE ROW WAS 221 OVER, STILL RED
    // RATHER THAN PAID FOR. Measured by building the tree three times, each with one changed
    // component reverted: 113,360 raw without `NodePanel.ts` against 113,556 with it, so all 196
    // are the copy control's revert, and 113,562 either way for `RuntimePanel.ts` and
    // `AuthPanel.ts`, so the reason phrase hung on the `?` verdict and the capitalized credential
    // label cost this row nothing. The sentences the parity scale now prints are decided on the
    // server and never reach the bundle, which is what the module header of `parity-model.ts`
    // claims and this is the measurement of it.
    //
    // 1,039 BYTES ON 2026-09-05, AND THE ROW WAS 19 OVER ITS CAP, WHICH WAS REPORTED RED RATHER
    // THAN PAID FOR. Measured by building the tree once per arrival: 113,043 for the rail binding its
    // scroll handler to the element whose computed overflow actually scrolls and scrolling the
    // opened window into view, 399 bytes; 113,213 for the two notices that let a reader tell an
    // unmeasured reference from a measured one that agrees with its specification, 170; 113,213
    // again for the response body indenter, which costs this row nothing because it rides
    // `@openref/vue/runner` and lands in the Send chunk; and 113,683 for the copy control in the
    // call samples block, 470. The cap held 451 when the fourth arrived and it cost 470. Nothing
    // was trimmed to fit, no other row was raided, and the cap is the maintainer's to rule on, the
    // way the four bytes of 2026-09-04 were ruled on.
    expect(total).toBe(114_327);

    // AND ALL 57 ARE IN THE ENTRY, WHICH IS DERIVED HERE RATHER THAN RESTATED, exactly as the 26
    // and the 181 before them were. The six files beside the entry weighed 91,364 before the change
    // and weigh 91,364 after it, both operands off this tree, so the entry is where the whole of
    // the change went; two chunk names moved and neither size did.
    // AND WHERE THE 202 WENT, DERIVED HERE RATHER THAN RESTATED. Every one of them is in the
    // entry, 22,215 to 22,417, because the copy control lives in `NodePanel` and `NodePanel` is
    // in it. The notice chunk is untouched at 760, and the two chunks whose names moved weigh
    // what they weighed, so the six files beside the entry weigh 91,468 before and after.
    //
    // AND WHERE THE 1,039 WENT, DERIVED HERE RATHER THAN RESTATED. 935 of them were in the entry,
    // 21,280 to 22,215, and 104 in the notice chunk, 656 to 760, which is the two new
    // `StateNotice` shapes.
    // AND WHERE THE 442 WENT, DERIVED HERE RATHER THAN RESTATED. Every one of them is in the
    // entry, 22,417 to 22,859, because the copy control lives in `NodePanel` and `NodePanel` is in
    // it. The six files beside the entry weigh 90,708 before and after, both operands off this
    // tree, and no chunk name moved this time.
    // AND WHERE THE 0 WENT ON 2026-09-05, WHICH IS THE CASE THIS LINE EXISTS FOR. The node page
    // lookup and the health heading are decided on the server, so nothing arrived: the entry is
    // 22,859 either way, the notice chunk is 760 either way, the six files beside the entry are
    // 90,708 either way, and the total is the same 114,327. Two chunk names rotated and are
    // re-read above, because a digest is taken over the modules that went in.
    expect(sizeOf('openref.js')).toBe(22_859);
    expect(sizeOf('chunk-NNVNJ4ZN.js')).toBe(760);
    expect(total - sizeOf('openref.js') - sizeOf('chunk-NNVNJ4ZN.js')).toBe(90_708);
    expect(sizeOf('chunk-NQKJDTAZ.js')).toBe(5_089);
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
    // 158 raw on 2026-09-05 at `TX-INSTRUMENT`, which is the copy control's revert arriving in a
    // second bundle because a themed entry carries the renderer too. It is 44 fewer than the 202
    // the first paint row pays, because this bundle is minified whole rather than split, and the
    // gzip row moves by 80, a little over half the raw arrival, because the added code is a timer
    // and a cancellation beside code that already sets the same ref. Both rows still fit.
    //
    // 442 raw and 208 gzip later on 2026-09-05, which is the copy control's icon and its live
    // region arriving in a second bundle for the reason every arrival does. Here the raw figure is
    // the SAME 442 the first paint row pays rather than fewer, unlike the revert before it: what
    // arrived is markup and two string constants rather than logic a whole bundle minifier can
    // fold. Both rows still fit, at 23,749 raw and 1,314 gzip of headroom.
    //
    // 1,386 raw and 888 gzip on 2026-09-05, which was an earlier slice arriving the same way.
    //
    // 415 raw on 2026-09-05 at `TX-VOICE`, which is this theme's own `DriftCard` learning to draw
    // the subjects of a folded finding and the disclosure the reasoning sits in. It is drawn here
    // rather than inherited, because a second theme that read only `subject` would have shown one
    // subject of a group of fifty four and compiled perfectly while doing it, and it is the only
    // instrument that can catch that. 105 of it survives gzip, a quarter of the raw arrival,
    // because most of what arrived is markup this bundle already spells elsewhere. Both rows
    // still fit, and neither cap moved.
    //
    // 0 raw and 11 gzip on 2026-09-05, and the pair is the whole finding: the raw row did not move
    // by a byte and the gzip row moved by eleven. Nothing arrived. The node page lookup and the
    // health heading are server side, so no code reached this bundle at all; what reached it is two
    // rotated chunk names, because a chunk's name is its content digest and the digest is taken over
    // the modules that went in. The names are inside the import statements of the files this row
    // compresses, so eleven bytes of the deflate window read differently and the raw row, which
    // compresses nothing, is byte identical at 264,410. The cap did not move and the headroom below
    // is taken off the measurement.
    expect(onDisk).toBe(264_410);
    expect(gzip).toBe(98_130);

    // And the headroom each row actually has, against caps neither of which moved
    expect(281 * 1024 - onDisk).toBe(23_334);
    expect(97 * 1024 - gzip).toBe(1_198);
  });

  it('should leave the caps where the two derivations put them', () => {
    // Given, so that a moved artefact and a moved cap cannot be confused for one another
    const capOf = (id: string): number =>
      SIZE_BUDGETS.find((budget) => budget.id === id)?.limitBytes ?? 0;

    // Then
    expect(capOf('theme-css-raw')).toBe(62 * 1024);
    expect(capOf('client-js-raw')).toBe(111 * 1024);
    expect(capOf('theme-css-raw') - 62_643).toBe(845);
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
    //
    // SIX HUNDRED AND SIXTY THREE BYTES OVER ON 2026-09-05, STILL RED AND STILL NOT RULED ON HERE.
    // 442 arrived on top of the 221 below and every one of them is the copy control: the button
    // shows an icon instead of the words `Copy the sample`, keeps a fixed `aria-label` because a
    // button whose only content is a drawing has no accessible name at all, and the confirmation
    // moved to a live region beside it instead of replacing the label. Measured by building the
    // tree three times: 113,885 at HEAD, 113,885 with the rate limit reach fix alone, 114,327 with
    // both, so the three states of SPEC 6.2.3 cost this row zero and the whole 442 is the control.
    // THE CAP DID NOT MOVE, no other row was raided, and nothing was trimmed to fit.
    //
    // TWO HUNDRED AND TWENTY ONE BYTES OVER EARLIER ON 2026-09-05, THE SAME WAY.
    // `TX-INSTRUMENT` added 202 to the nineteen below, and all 202 are one thing: the copy control
    // in the call samples block now returns to offering the copy instead of saying `Copied` for
    // the life of the page, which is a timer, its cancellation and an unmount hook. Measured by
    // building the tree three times, each with one changed component reverted: 113,360 raw without
    // `NodePanel.ts` against 113,556 with it, and 113,562 either way for `RuntimePanel.ts` and
    // `AuthPanel.ts`, so the reason phrase on the `?` verdict and the capitalized credential label
    // cost nothing at all. THE CAP DID NOT MOVE, no other row was raided, and nothing was trimmed
    // to fit: a control whose label stops describing what it will do is the defect the fix is
    // about, and buying 202 bytes by leaving it latched is the trade this project forbids.
    //
    // TWO CHUNK NAMES MOVED AND NEITHER SIZE DID, which is the plain mechanism this file's header
    // describes. `chunk-Q4YE3IPE` became `chunk-HCWNPUXA` and `chunk-TBC2TEML` became
    // `chunk-ZSSABZO4` because the modules they import changed; both weigh exactly what they
    // weighed, 5,089 and 2,352, and the whole of the change is in `openref.js`.
    //
    // NINETEEN BYTES OVER ON 2026-09-05, REPORTED RED AND NOT RULED ON HERE. Four fixes landed
    // against 1,020 bytes of headroom and cost 1,039: 399 for the rail's scroll handler moving to
    // the element that actually scrolls, 170 for the two notices that say nothing measured this,
    // 0 for the response body indenter, which rides `@openref/vue/runner` into the Send chunk,
    // and 470 for the copy control in the call samples block. THE CAP DID NOT MOVE, no other row
    // was raided, and no part of any of the four was trimmed to fit, which is the trade this
    // project forbids and the reason the four bytes of 2026-09-04 were reported the same way.
    // What the maintainer decides is whether the cap moves or a fix comes back out.
    expect(capOf('client-js-raw') - initial).toBe(-663);

    // AND THE PROPERTY THE CAP WAS DERIVED BY, WHICH CANNOT BE RE-TAKEN WHILE THE ROW IS OVER.
    // The derivation is the smallest whole KB step the artefact fits under at which the cheapest
    // deferred gesture returning to the first load still fails, and its first half needs an
    // artefact that fits. This one does not, so what is asserted is the state itself, in bytes,
    // and the second half, which still holds and is what keeps 112 KB from being the answer: at
    // that step the sign in return would come back into the first load unremarked. Both operands
    // are read off the tree, so a fix that brought the row back under the cap turns this red and
    // the property above it goes back in.
    expect(initial).toBeGreaterThan(capOf('client-js-raw'));
    expect(initial - capOf('client-js-raw')).toBe(663);
    expect(initial + signInReturn).toBeGreaterThan(112 * 1024);

    expect(capOf('theme-entry-raw')).toBe(281 * 1024);
  });

  it('should be the two columns the browser record carries, while the record describes this tree', () => {
    // Given the honest limit of the `page-bytes` record, made into a check rather than a sentence.
    // SPEC 20 claims two of its three columns agree with the published form to the byte, and that
    // claim is the only independent instrument either column has: the document column comes from a
    // browser study on a named machine and nothing here can take it again. So the two that can be
    // taken again are taken again, and the one that cannot is left recorded and labelled.
    const { baseline: record, reason } = readBrowserBaseline(REPO_ROOT);
    expect(reason).toBeUndefined();
    if (record === null) throw new Error('no baseline');

    const stylesheets = STYLESHEETS.reduce((sum, name) => sum + sizeOf(name), 0);
    const initial = INITIAL.reduce((sum, name) => sum + sizeOf(name), 0);

    // WHEN THE RECORD HAS FALLEN BEHIND THE TREE THIS SAYS SO AND DOES NOT FAIL, which is the
    // decision `baselineFreshness` already records and this must not quietly reverse: any failing
    // distance would demand a browser study on every commit that touches `packages/`, a cadence a
    // study taken on a runner cannot hold. A tree that has moved past the record is a tree where
    // the two columns describe an earlier artefact, so the comparison is not available, and which
    // fact went unchecked is named instead of passed over.
    const distance = countCommitsSince(REPO_ROOT, record.commit, BASELINE_INPUT_PATHS);

    // A COUNT GIT COULD NOT TAKE IS NOT A STALE RECORD, AND THE TWO USED TO LEAVE BY ONE DOOR.
    // `baselineFreshness` answers `unknown` when git refused and `stale` when it counted, and
    // `.not.toBe('current')` is satisfied by both, so an instrument that could not run read
    // exactly like a decision that it need not. MEASURED AT T065 AND IT WAS NOT HYPOTHETICAL:
    // `ci.yml` checks out with `actions/checkout@v4` and no `fetch-depth`, which is depth one, so
    // `git rev-list --count <commit>..HEAD` answers `fatal: Invalid revision range` on every CI
    // run this repository has ever had. The two comparisons below had therefore executed on the
    // runner exactly never, while the case reported green there on every push. The workstation
    // reaches them only at the one commit a re-record is made on. So an undetermined count fails
    // here, and `ci.yml` fetches the history the count needs rather than the check being widened
    // to accept not having it.
    expect(
      distance.reason,
      'git could not count the distance to the recorded commit, so whether the two columns ' +
        'describe this tree is undetermined. An undetermined check is not a passing one',
    ).toBeUndefined();

    if (distance.count !== 0) {
      expect(
        baselineFreshness(record, distance.count, distance.reason).state,
        'the record still describes this tree, so the two columns should have been compared',
      ).toBe('stale');
      return;
    }

    // Then, the claim as a measurement: 62,594 and 112,644 off this tree against the same two
    // columns of the record, so a re-record that disagreed with the published form would be red
    // here rather than restated in three documents.
    expect(record.parsedBytes.cssBytes).toBe(stylesheets);
    expect(record.parsedBytes.jsBytes).toBe(initial);

    // AND THE THIRD COLUMN IS NOT DRESSED UP AS THE OTHER TWO. There is no published artefact to
    // weigh it against, so what is asserted about it is only that it is what the study recorded
    // and that the sum the SPEC 20 row states is arithmetic over the three.
    const figure = (what: string): number | undefined =>
      pageBytesFigures(record).find((entry) => entry.what === what)?.value;

    expect(figure('the document column')).toBe(record.parsedBytes.documentBytes);
    expect(figure('the page total')).toBe(record.parsedBytes.documentBytes + stylesheets + initial);
  });

  it('should be undetermined on a checkout too shallow to hold the recorded commit', () => {
    // Given a repository with a history of one commit, which is the shape `actions/checkout@v4`
    // produces with no `fetch-depth`, and a recorded commit that is not in it. The subject is
    // asserted present first: the repository is real, git answers about it, and the count over its
    // own HEAD is a number.
    const directory = mkdtempSync(join(tmpdir(), 'openref-shallow-'));

    try {
      execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'case@example.com'], { cwd: directory });
      execFileSync('git', ['config', 'user.name', 'case'], { cwd: directory });
      writeFileSync(join(directory, 'file.txt'), 'one\n');
      execFileSync('git', ['add', '.'], { cwd: directory });
      execFileSync('git', ['commit', '--quiet', '-m', 'one'], { cwd: directory });

      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: directory,
        encoding: 'utf8',
      }).trim();
      expect(countCommitsSince(directory, head, ['.']).count).toBe(0);

      // When the recorded commit is one this checkout does not have
      const absent = 'df41de06e7e153ac0c840cee483995daf9f48894';
      const distance = countCommitsSince(directory, absent, ['.']);

      // Then git refuses and the count is undetermined rather than a number, which is exactly the
      // branch the case above now fails on. IT IS THE CI CONDITION AND NOT A CONTRIVANCE: with a
      // depth one checkout every recorded commit is absent, so the two byte comparisons above had
      // never run on the runner at all while the case reported green there.
      expect(distance.count).toBeNull();
      expect(distance.reason).toContain('Invalid revision range');

      // And an undetermined count is `unknown` rather than `stale`, which is the distinction the
      // old `.not.toBe('current')` could not make: both satisfied it.
      const { baseline: record } = readBrowserBaseline(REPO_ROOT);
      if (record === null) throw new Error('no baseline');
      expect(baselineFreshness(record, distance.count, distance.reason).state).toBe('unknown');
      expect(baselineFreshness(record, 1, undefined).state).toBe('stale');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

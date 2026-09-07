/**
 * The two raw budgets weigh the form a reader downloads, and this pins why the two caps are what
 * they are once they do.
 *
 * The subject moved on 2026-08-31 by the maintainer's ruling on the section `T061` filed and
 * `T062` re-measured: until then both rows weighed the files as `pnpm build` leaves them, and the
 * asset catalog rewrites every sibling reference onto a digest carrying name before anything is
 * served. SPEC 20 carries the itemised difference; what is here is the arithmetic that has to keep
 * holding for the two caps to be the ones the derivations choose.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAssetCatalog,
  DIGEST_LENGTH,
  siblingReferences,
  type AssetSource,
} from '@openref/render';
import { afterEach, describe, expect, it } from 'vitest';
import { SIZE_BUDGETS, type SizeBudget } from '../../src/config';
import { collectBudgetOutcomes, type BudgetReport } from '../../src/lib/budget-report';
import { evaluateBudget, gzipSizeOf } from '../../src/lib/budgets';
import {
  forgetPublishedForm,
  readPublishedForm,
  servedReferenceOf,
} from '../../src/lib/published-form';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const FONTS = join(REPO_ROOT, 'packages', 'theme', 'fonts');

/** What one rewritten reference costs: the dot before the digest, and the digest. */
const COST_PER_REFERENCE = DIGEST_LENGTH + 1;

/** The published readings SPEC 20 records, taken on 2026-08-30 and reproduced twice. */
const PUBLISHED = {
  themeCssBytes: 62_594,
  clientJsBytes: 110_539,
  /** The cheapest deferred gesture, published, which is what the JS property is checked with. */
  signInReturnBytes: 1_468,
  /** The two rows the second ruling moved, re-measured on 2026-09-02. */
  schemaGzipBytes: 2_150,
  schemaRawBytes: 5_227,
  themeEntryGzipBytes: 90_284,
  themeEntryRawBytes: 248_936,
} as const;

/**
 * The same quantities after `TX-SOCKET-CONSOLE`, which is the arrival two of the caps moved for.
 *
 * KEPT BESIDE THE FIGURES ABOVE RATHER THAN REPLACING THEM. Those are what the two rulings
 * re-derived from, and a test that overwrote them would stop being able to say that the caps did
 * not move at the moment the subject did. These are what the caps are checked against now.
 */
const AFTER_CONSOLE = {
  /** The published initial closure with the socket console's gate and seam in it. */
  clientJsBytes: 111_826,
  /** The same closure on disk, which is what the cap used to be taken on. */
  clientJsOnDiskBytes: 111_503,
  /** The telltale entry on disk, which is the form its raw row weighs. */
  themeEntryRawBytes: 260_847,
  /** The telltale entry published, which is the form its gzip row weighs. */
  themeEntryGzipBytes: 96_355,
} as const;

/**
 * The published initial closure as this tree leaves it, which is what the 111 KB cap was derived
 * from on 2026-09-04.
 *
 * KEPT BESIDE THE TWO SETS ABOVE FOR THE REASON THEY ARE KEPT BESIDE EACH OTHER. Each is the
 * artefact one derivation was taken against, and the property below has to choose the recorded cap
 * from each of them in turn; a file that overwrote the earlier figures could assert the current cap
 * and nothing about whether the rule that produced it is the same rule. The figure itself is read
 * off the tree by `test/integration/published-form.spec.ts`, so it cannot go stale here without
 * going red there.
 */
const TODAY = {
  /** 57 bytes over `AFTER_CONSOLE` plus the three arrivals between, per SPEC 20. */
  clientJsBytes: 112_644,
} as const;

/**
 * The property `client-js-raw`'s cap is derived by, as SPEC 20 has recorded it since `T011-R`.
 *
 * IT IS THIS ROW'S OWN AND IS NOT SHARED WITH ITS NEIGHBOURS, which is why it is written as a
 * function rather than as a constant beside them: `client-js-schema` is its measurement plus ten
 * percent rounded down to a hundred bytes, `theme-entry-raw` is plus ten percent rounded up to a
 * whole KiB, and `theme-css-raw` is the smallest whole KB step the artefact fits under with no
 * second clause at all. Refusing a general rule for the three was deliberate.
 *
 * @param artefact - What the first paint publishes
 * @param cheapestGesture - What the cheapest deferred gesture publishes
 * @returns The smallest whole KB step the artefact fits under at which that gesture returning to
 *   the first load still fails the budget
 */
function smallestStepKeepingTheProperty(artefact: number, cheapestGesture: number): number {
  for (let kilobytes = 1; kilobytes <= 1024; kilobytes += 1) {
    const step = kilobytes * 1024;
    if (artefact <= step && artefact + cheapestGesture > step) return step;
  }

  throw new Error('no whole KB step keeps the property');
}

/** The same quantities in the form the caps used to be taken on. */
const ON_DISK = {
  themeCssBytes: 62_424,
  clientJsBytes: 110_284,
  signInReturnBytes: 1_451,
  schemaGzipBytes: 2_082,
  themeEntryGzipBytes: 89_545,
} as const;

function budget(id: string): (typeof SIZE_BUDGETS)[number] {
  const found = SIZE_BUDGETS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`SIZE_BUDGETS has no budget ${id}`);

  return found;
}

describe('which budgets weigh the published form', () => {
  it('should be the four rows the two rulings name, and no others', () => {
    // Given the ruling of 2026-08-31, which moved the subject of two rows and no cap but one, and
    // the ruling of 2026-09-02, which moved the two the first pass found already over their cap in
    // the form that ships. A fifth row appearing here would be a cap re-derived by nobody: the
    // published form of every other row is either equal to its form on disk or inside its cap
    // with room to spare, and SPEC 20 records both readings.
    const published = SIZE_BUDGETS.filter((entry) => entry.form === 'published');

    // When
    const ids = published.map((entry) => entry.id).sort();

    // Then
    expect(ids).toEqual(['client-js-raw', 'client-js-schema', 'theme-css-raw', 'theme-entry']);
  });

  it('should carry the flag exactly where the cap came from the published measurement', () => {
    // Given, the quantity is not the discriminator and was never the rule, though the first two
    // rows were both `parse` and could be read that way. What this flag says is that this row's
    // cap was derived from the form that ships: a row weighing the published bytes against a cap
    // taken on the ones nobody downloads is the defect, in either quantity.
    const published = SIZE_BUDGETS.filter((entry) => entry.form === 'published');

    // When
    const caps = Object.fromEntries(published.map((entry) => [entry.id, entry.limitBytes]));

    // Then, each is the figure SPEC 20's re-derivation states, and two of the four are `transfer`
    expect(published.filter((entry) => entry.quantity === 'transfer')).toHaveLength(2);
    expect(caps).toEqual({
      'client-js-raw': 111 * 1024,
      'client-js-schema': 2_300,
      'theme-css-raw': 62 * 1024,
      'theme-entry': 97 * 1024,
    });
  });
});

describe('the theme-css-raw cap, re-derived from the published form', () => {
  const cap = budget('theme-css-raw').limitBytes;

  it('should be the smallest whole KB step the published stylesheet fits under', () => {
    // Given the recorded property: the cap is the tightest whole KB step the built stylesheet
    // fits under, and the stylesheet is now the one that ships.
    const steps = [61, 62, 63].map((kilobytes) => ({
      kilobytes,
      bytes: kilobytes * 1024,
      fits: PUBLISHED.themeCssBytes <= kilobytes * 1024,
    }));

    // When
    const smallestThatFits = steps.find((step) => step.fits);

    // Then
    expect(steps[0]?.fits).toBe(false);
    expect(smallestThatFits?.kilobytes).toBe(62);
    expect(cap).toBe(62 * 1024);
  });

  it('should have been over the old cap in the published form, which is why the row moved', () => {
    // Given the cap the row carried while it weighed the form on disk
    const previous = 61 * 1024;

    // When
    const onDisk = evaluateBudget(
      previous,
      [{ path: 'theme', rawBytes: ON_DISK.themeCssBytes, gzipBytes: 0 }],
      'parse',
    );
    const published = evaluateBudget(
      previous,
      [{ path: 'theme', rawBytes: PUBLISHED.themeCssBytes, gzipBytes: 0 }],
      'parse',
    );

    // Then, the same commit, green on the form nobody downloads and 130 over on the one they do
    expect(onDisk.ok).toBe(true);
    expect(published.ok).toBe(false);
    expect(published.overBy).toBe(130);
  });

  it('should leave the headroom SPEC 20 states, rather than a figure nobody wrote down', () => {
    // Given
    // When
    const headroom = cap - PUBLISHED.themeCssBytes;

    // Then
    expect(headroom).toBe(894);
  });
});

describe('the client-js-raw cap, re-checked against the published form', () => {
  const cap = budget('client-js-raw').limitBytes;

  it('should be the one whole KB step the property allows on the artefact this tree publishes', () => {
    // Given the recorded property: the artefact fits, and the cheapest deferred gesture returning
    // to the first load still fails the budget. Applied to today's artefact, because a property
    // re-checked only against the artefact it was derived from is a property nobody re-checked.
    const returning = TODAY.clientJsBytes + PUBLISHED.signInReturnBytes;

    // When
    const derived = smallestStepKeepingTheProperty(
      TODAY.clientJsBytes,
      PUBLISHED.signInReturnBytes,
    );

    // Then, 111 KB is 113,664: the artefact fits and 114,112 does not, so a return of the cheapest
    // gesture still fails. 110 KB at 112,640 no longer holds the artefact at all and 112 KB at
    // 114,688 would let that return in unremarked, so neither neighbour is available.
    expect(returning).toBe(114_112);
    expect(TODAY.clientJsBytes).toBeGreaterThan(110 * 1024);
    expect(returning).toBeLessThanOrEqual(112 * 1024);
    expect(derived).toBe(111 * 1024);
    expect(cap).toBe(111 * 1024);
  });

  it('should be the same property that chose every cap this row has carried', () => {
    // Given the three earlier artefacts, each with the cap SPEC 20 records against it. THIS IS THE
    // FALSIFICATION THE CASE ABOVE CANNOT MAKE: one artefact and one cap agree with any rule that
    // happens to hit that number once, and what the maintainer ruled was that this row re-derives by
    // ITS OWN property rather than by a shared one. A rule that chose 111 KB today and disagreed
    // with any of these is not the rule this row has been derived by.
    const gesture = PUBLISHED.signInReturnBytes;

    // When
    const chosen = [110_539, 110_559, AFTER_CONSOLE.clientJsBytes, TODAY.clientJsBytes].map(
      (artefact) => smallestStepKeepingTheProperty(artefact, gesture) / 1024,
    );

    // Then, 108 for the two readings before the socket console, 110 for the console's own, 111 now
    expect(chosen).toEqual([108, 108, 110, 111]);
  });

  it('should have moved by one step for the sentence and not by more, which is the whole rule', () => {
    // Given the cap before the arrival and the artefact before it, so the move is measured rather
    // than asserted: 110 KB held 112,587 with 53 bytes, and 112,644 does not fit it at all
    // When
    const previous = 110 * 1024;

    // Then, the 57 bytes of the third sentence under the tabs against 53 of headroom, which is the
    // four byte overrun the row stood red at until the maintainer ruled on the cap.
    expect(previous - 112_587).toBe(53);
    expect(TODAY.clientJsBytes - 112_587).toBe(57);
    expect(TODAY.clientJsBytes).toBeGreaterThan(previous);
    expect(TODAY.clientJsBytes - previous).toBe(4);
    expect(cap - previous).toBe(1024);
  });

  it('should state 1,020 bytes of headroom, which is the number the entry says to watch', () => {
    // Given, the margin under the published form
    // When
    const headroom = cap - TODAY.clientJsBytes;

    // Then, and the payer beside it: all 57 bytes are in the entry, so the six files beside it
    // weigh the same 91,364 they weighed before the sentence arrived
    expect(headroom).toBe(1_020);
    expect(TODAY.clientJsBytes - 91_364).toBe(21_280);
  });

  it('should have been red on the cap it moved from, which is why the cap moved', () => {
    // Given, the direction matters: a cap moved to make a build pass is the one move this project
    // forbids, so what makes this one legal has to be visible. The row was reported over by four
    // bytes with the cap untouched, the fix was not trimmed to fit, and only then was the cap
    // re-derived by the row's own property.
    const previous = 110 * 1024;

    // When
    const onTheOldCap = evaluateBudget(
      previous,
      [{ path: 'entry', rawBytes: TODAY.clientJsBytes, gzipBytes: 0 }],
      'parse',
    );
    const onTheNewCap = evaluateBudget(
      cap,
      [{ path: 'entry', rawBytes: TODAY.clientJsBytes, gzipBytes: 0 }],
      'parse',
    );

    // Then
    expect(onTheOldCap.ok).toBe(false);
    expect(onTheOldCap.overBy).toBe(4);
    expect(onTheNewCap.ok).toBe(true);
    expect(onTheNewCap.overBy).toBe(0);
  });
});

describe('the client-js-schema cap, re-derived from the published form', () => {
  const cap = budget('client-js-schema').limitBytes;
  const twin = budget('client-js-schema-raw').limitBytes;

  it('should be the measurement plus ten percent, rounded down to a hundred bytes', () => {
    // Given this row's own recorded property, the one the 2,100 of TX-MARKUP came from. The
    // falsification is that the same property on the form nobody downloads chooses 2,200 instead,
    // so the figure below is about which form was measured and not about the arithmetic.
    const byProperty = (measured: number): number => Math.floor((measured * 1.1) / 100) * 100;

    // When
    const fromPublished = byProperty(PUBLISHED.schemaGzipBytes);

    // Then
    expect(byProperty(1_977)).toBe(2_100);
    expect(fromPublished).toBe(2_300);
    expect(byProperty(ON_DISK.schemaGzipBytes)).toBe(2_200);
    expect(cap).toBe(2_300);
  });

  it('should have been over the old cap in the published form, which is why the row moved', () => {
    // Given the cap the row carried while it weighed the form on disk
    const previous = 2_100;

    // When
    const onDisk = evaluateBudget(
      previous,
      [{ path: 'schema', rawBytes: 0, gzipBytes: ON_DISK.schemaGzipBytes }],
      'transfer',
    );
    const published = evaluateBudget(
      previous,
      [{ path: 'schema', rawBytes: 0, gzipBytes: PUBLISHED.schemaGzipBytes }],
      'transfer',
    );

    // Then, the same commit, green on the form nobody downloads and 50 over on the one they do
    expect(onDisk.ok).toBe(true);
    expect(published.ok).toBe(false);
    expect(published.overBy).toBe(50);
  });

  it('should leave the twin binding the pair, which is why the gesture carries two caps', () => {
    // Given, a cap with more headroom than its twin is a cap nothing reaches. SPEC 20 states both
    // numbers rather than leaving a reader to notice which one stops a change.
    // When
    const headroom = cap - PUBLISHED.schemaGzipBytes;
    const twinHeadroom = twin - PUBLISHED.schemaRawBytes;

    // Then
    expect(headroom).toBe(150);
    expect(twinHeadroom).toBe(73);
    expect(twinHeadroom).toBeLessThan(headroom);
    expect(twin).toBe(5_300);
  });
});

describe('the theme-entry cap, re-derived from the published form', () => {
  const cap = budget('theme-entry').limitBytes;
  const twin = budget('theme-entry-raw').limitBytes;

  it('should be the measurement plus ten percent, rounded up to the whole KiB', () => {
    // Given this row's own recorded property, the one the 78 KB of T033 and the 88 KB of TX-SHAPES
    // both came from. Both historical figures are checked here, because a property that only
    // reproduces the latest number is a property fitted to one reading.
    const byProperty = (measured: number): number => Math.ceil((measured * 1.1) / 1024) * 1024;

    // When
    const fromPublished = byProperty(PUBLISHED.themeEntryGzipBytes);

    // Then
    expect(byProperty(72_088)).toBe(78 * 1024);
    expect(byProperty(81_562)).toBe(88 * 1024);
    expect(fromPublished).toBe(97 * 1024);
    expect(cap).toBe(97 * 1024);
  });

  it('should have been over the old cap in the published form, which is why the row moved', () => {
    // Given the cap the row carried while it weighed the form on disk
    const previous = 88 * 1024;

    // When
    const onDisk = evaluateBudget(
      previous,
      [{ path: 'entry', rawBytes: 0, gzipBytes: ON_DISK.themeEntryGzipBytes }],
      'transfer',
    );
    const published = evaluateBudget(
      previous,
      [{ path: 'entry', rawBytes: 0, gzipBytes: PUBLISHED.themeEntryGzipBytes }],
      'transfer',
    );

    // Then
    expect(onDisk.ok).toBe(true);
    expect(published.ok).toBe(false);
    expect(published.overBy).toBe(172);
  });

  it('should have left the twin binding the pair at the moment of that derivation', () => {
    // Given the state on 2026-09-02 before `TX-SOCKET-CONSOLE`, which is what SPEC 20 recorded
    // and what the case below is a reversal of. The caps are written out rather than read off the
    // configuration, because this is a historical reading and the raw one has moved since.
    // When
    const headroom = 97 * 1024 - PUBLISHED.themeEntryGzipBytes;
    const twinHeadroom = 244 * 1024 - PUBLISHED.themeEntryRawBytes;

    // Then
    expect(headroom).toBe(9_044);
    expect(twinHeadroom).toBe(920);
    expect(twinHeadroom).toBeLessThan(headroom);
    expect(cap).toBe(97 * 1024);
  });

  it('should have the pair bound by the gzip row after `TX-SOCKET-CONSOLE`, which is a reversal', () => {
    // Given the arrival the raw row was re-derived for: this directory carries a chunk per
    // gesture by construction, so the socket console arrives in it whole. The gzip row was not
    // re-derived, because 96,355 still fits 99,328.
    // When
    const gzipHeadroom = cap - AFTER_CONSOLE.themeEntryGzipBytes;
    const rawHeadroom = twin - AFTER_CONSOLE.themeEntryRawBytes;

    // Then the tighter of the two has changed sides, which is what having two caps is for
    expect(gzipHeadroom).toBe(2_973);
    expect(rawHeadroom).toBe(26_897);
    expect(gzipHeadroom).toBeLessThan(rawHeadroom);
    expect(cap).toBe(97 * 1024);
    expect(twin).toBe(281 * 1024);
  });
});

describe('which served reference a budget belongs to', () => {
  it('should be the themed entry for the row over the telltale directory', () => {
    // Given the row whose files five of eighteen are in no asset of the default reference
    // When
    const reference = servedReferenceOf(budget('theme-entry').roots);

    // Then
    expect(reference).toBe('packages/theme-telltale/dist/entry/entry.js');
  });

  it('should be the default entry for the client bundle rows and for the stylesheets', () => {
    // Given, the stylesheets are linked from the default page rather than being an entry
    // When
    const fromBundle = servedReferenceOf(budget('client-js-schema').roots);
    const fromStylesheets = servedReferenceOf(budget('theme-css-raw').roots);

    // Then
    expect(fromBundle).toBe('packages/nest/dist/browser/openref.js');
    expect(fromStylesheets).toBe('packages/nest/dist/browser/openref.js');
  });

  it('should refuse roots that span two shipped entries rather than taking the first', () => {
    // Given the pair that really does span two, so this is a refusal about a case that exists
    const roots = budget('client-wc').roots;

    // When
    const act = (): unknown => servedReferenceOf(roots);

    // Then
    expect(roots).toHaveLength(2);
    expect(act).toThrow(/span 2 shipped bundles/u);
  });

  it('should refuse roots that name no served reference at all', () => {
    // Given
    // When
    const act = (): unknown => servedReferenceOf(['packages/nowhere/dist']);

    // Then
    expect(act).toThrow(/belong to no served reference/u);
  });
});

describe('what the catalog does to the shipped stylesheet, over the committed files', () => {
  const stylesheet = readFileSync(join(FONTS, 'fonts.css'));
  const references = siblingReferences(stylesheet.toString('utf8'));

  const sources: AssetSource[] = [
    { name: 'fonts.css', bytes: new Uint8Array(stylesheet) },
    ...references.map((name) => ({
      name,
      bytes: new Uint8Array(readFileSync(join(FONTS, name))),
    })),
  ];

  it('should name the ten font files the delta is made of, before anything is said about them', () => {
    // Given the claim SPEC 20 makes: the whole 170 bytes is ten references in this one file. A
    // proof about them has to start by asserting they are there.
    // Then
    expect(references).toHaveLength(10);
    expect(references.every((name) => name.endsWith('.woff2'))).toBe(true);
    expect(sources).toHaveLength(11);
  });

  it('should lengthen the stylesheet by one dot and one digest per reference', () => {
    // Given
    const catalog = buildAssetCatalog(sources);

    // When
    const published = catalog.byName.get('fonts.css');

    // Then
    expect(COST_PER_REFERENCE).toBe(17);
    expect(stylesheet.byteLength).toBe(4_211);
    expect(published?.bytes.byteLength).toBe(4_211 + references.length * COST_PER_REFERENCE);
    expect(published?.bytes.byteLength).toBe(4_381);
  });

  it('should leave every font file byte identical, so the three font budgets are untouched', () => {
    // Given, a claim of absence over a set asserted to be present above
    const catalog = buildAssetCatalog(sources);

    // When
    const moved = references.filter(
      (name) =>
        catalog.byName.get(name)?.bytes.byteLength !==
        sources.find((source) => source.name === name)?.bytes.byteLength,
    );

    // Then
    expect(moved).toEqual([]);
    expect(catalog.assets).toHaveLength(11);
  });

  it('should leave a stylesheet that names nothing byte identical, which is what the other two are', () => {
    // Given, `theme.css` and `tokens.css` are built rather than committed, so the property they
    // rely on is proved here on a stylesheet with the same shape: no reference to another asset.
    const plain = new TextEncoder().encode('.oref-root { color: var(--oref-color-fg); }');

    // When
    const catalog = buildAssetCatalog([{ name: 'plain.css', bytes: plain }]);

    // Then
    expect(siblingReferences(new TextDecoder().decode(plain))).toEqual([]);
    expect(catalog.byName.get('plain.css')?.bytes.byteLength).toBe(plain.byteLength);
  });
});

describe('what the budgets report does with a published form budget', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    forgetPublishedForm();
  });

  /** A repository shaped tree holding exactly the files a probe budget is written about. */
  function tree(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(join(tmpdir(), 'openref-published-form-'));
    roots.push(root);

    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(join(root, path.slice(0, path.lastIndexOf('/'))), { recursive: true });
      writeFileSync(join(root, path), contents, 'utf8');
    }

    return root;
  }

  /** A budget over one directory, with nothing partitioned and nothing else in the way. */
  function probe(overrides: Partial<SizeBudget> = {}): SizeBudget {
    return {
      id: 'probe',
      label: 'probe',
      limitBytes: 1_000_000,
      quantity: 'parse',
      roots: ['packages/probe/dist'],
      extensions: ['.css'],
      producedBy: 'this test',
      ...overrides,
    };
  }

  const outcomeOf = (report: BudgetReport): string =>
    report.outcomes.find((entry) => entry.id === 'probe')?.message ?? '';
  const errorOf = (report: BudgetReport): string =>
    report.errors.find((message) => message.startsWith('probe:')) ?? '';

  const SOURCE_CSS = `@font-face{src:url(./f.woff2)}${' '.repeat(70)}`;
  const PUBLISHED_CSS = `@font-face{src:url(./f.0123456789abcdef.woff2)}${' '.repeat(70)}`;

  it('should weigh the published bytes, and weigh the bytes on disk when the row does not say published', () => {
    // Given one tree and one file, read twice: once by a row that says published and once by the
    // same row with that word taken away. The falsification is the second reading.
    const root = tree({ 'packages/probe/dist/a.css': SOURCE_CSS });
    const published = (): ReadonlyMap<string, Uint8Array> =>
      new Map([['a.css', new TextEncoder().encode(PUBLISHED_CSS)]]);

    // When
    const asPublished = collectBudgetOutcomes(root, {
      budgets: [probe({ form: 'published' })],
      publishedForm: published,
    });
    const asOnDisk = collectBudgetOutcomes(root, { budgets: [probe()], publishedForm: published });

    // Then, seventeen bytes apart, which is the whole subject move in one file
    expect(PUBLISHED_CSS.length - SOURCE_CSS.length).toBe(17);
    expect(outcomeOf(asPublished)).toContain(`${String(PUBLISHED_CSS.length)} B raw`);
    expect(outcomeOf(asOnDisk)).toContain(`${String(SOURCE_CSS.length)} B raw`);
    expect(outcomeOf(asPublished)).not.toBe(outcomeOf(asOnDisk));
  });

  it('should take the transferred quantity from the published bytes too, not from the file on disk', () => {
    // Given, the defect the comment beside the measurement names: the raw size of what ships and
    // the gzip size of what does not is one artefact reported as two.
    const root = tree({ 'packages/probe/dist/a.css': SOURCE_CSS });
    const publishedBytes = new TextEncoder().encode(PUBLISHED_CSS);

    // When
    const report = collectBudgetOutcomes(root, {
      budgets: [probe({ form: 'published', quantity: 'transfer' })],
      publishedForm: () => new Map([['a.css', publishedBytes]]),
    });

    // Then
    const publishedGzip = gzipSizeOf(Buffer.from(publishedBytes));
    expect(publishedGzip).not.toBe(gzipSizeOf(Buffer.from(SOURCE_CSS, 'utf8')));
    expect(outcomeOf(report)).toContain(`${String(publishedGzip)} B gzip`);
  });

  it('should fail the budget when the catalog cannot be read, rather than weighing the disk', () => {
    // Given a tree whose files exist and a catalog that does not
    const root = tree({ 'packages/probe/dist/a.css': SOURCE_CSS });

    // When
    const report = collectBudgetOutcomes(root, {
      budgets: [probe({ form: 'published' })],
      publishedForm: () => {
        throw new Error('the renderer is not built');
      },
    });

    // Then, and the falsification is that the same row with a catalog reports a figure instead
    expect(errorOf(report)).toContain('the asset catalog could not be read');
    expect(errorOf(report)).toContain('the renderer is not built');
    expect(outcomeOf(report)).toBe('');
    expect(
      outcomeOf(
        collectBudgetOutcomes(root, {
          budgets: [probe({ form: 'published' })],
          publishedForm: () => new Map([['a.css', new TextEncoder().encode(SOURCE_CSS)]]),
        }),
      ),
    ).toContain('raw');
  });

  it('should fail the budget when a file it walked is in no catalog entry', () => {
    // Given a file that is present, so this is a proof about a file the walk really found
    const root = tree({ 'packages/probe/dist/a.css': SOURCE_CSS });

    // When
    const report = collectBudgetOutcomes(root, {
      budgets: [probe({ form: 'published' })],
      publishedForm: () => new Map(),
    });

    // Then
    expect(errorOf(report)).toContain('are not in the asset catalog');
    expect(errorOf(report)).toContain('a.css');
    expect(outcomeOf(report)).toBe('');
  });

  it('should refuse two files of one base name rather than weighing one of them twice', () => {
    // Given the latent case: one budget over two roots, each holding a file of the same name. The
    // catalog is keyed by that name, so both would read one entry.
    const root = tree({
      'packages/probe/dist/x.js': 'one',
      'packages/other/dist/x.js': 'two',
    });
    const twoRoots = probe({
      form: 'published',
      roots: ['packages/probe/dist', 'packages/other/dist'],
      extensions: ['.js'],
    });

    // When
    const report = collectBudgetOutcomes(root, {
      budgets: [twoRoots],
      publishedForm: () => new Map([['x.js', new TextEncoder().encode('one')]]),
    });

    // Then
    expect(errorOf(report)).toContain('carried by more than one file');
    expect(errorOf(report)).toContain('x.js');
    expect(outcomeOf(report)).toBe('');
  });

  it('should weigh both files once their names differ, which is what makes the refusal a refusal', () => {
    // Given the same shape with the collision taken away
    const root = tree({
      'packages/probe/dist/x.js': 'one',
      'packages/other/dist/y.js': 'two',
    });

    // When
    const report = collectBudgetOutcomes(root, {
      budgets: [
        probe({
          form: 'published',
          roots: ['packages/probe/dist', 'packages/other/dist'],
          extensions: ['.js'],
        }),
      ],
      publishedForm: () =>
        new Map([
          ['x.js', new TextEncoder().encode('one!')],
          ['y.js', new TextEncoder().encode('two!')],
        ]),
    });

    // Then
    expect(errorOf(report)).toBe('');
    expect(outcomeOf(report)).toContain('8 B raw');
    expect(outcomeOf(report)).toContain('2 file(s)');
  });

  it('should refuse a tree that is not a built repository, which is the real reader failing', () => {
    // Given a directory with no renderer and no artefacts in it. This drives the real reader
    // rather than a double, and the cache is cleared so the two trees of this file cannot share
    // an answer.
    const root = tree({ 'packages/probe/dist/a.css': SOURCE_CSS });
    forgetPublishedForm();

    // When
    const act = (): unknown => readPublishedForm(root);

    // Then
    expect(act).toThrow();
  });
});

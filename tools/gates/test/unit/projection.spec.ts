import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILD_FILE,
  BUILD_LINE_COUNT,
  BUILD_TASK_COUNT,
  DEFERRAL_DOCUMENTS,
  PROJECTION_ARTEFACT_BUDGET,
  PROJECTION_LEAF_FLOOR,
} from '../../src/config';
import { buildManifestGate } from '../../src/gates/build-manifest.gate';
import { projectionPrivacyGate } from '../../src/gates/projection-privacy.gate';
import { AI_DOCS_ABSENT_CALL_SITES, AI_DOCS_DIR, aiDocsPresent } from '../../src/lib/ai-docs';
import {
  checkBuildManifest,
  parseAmendmentSections,
  parseOwnedEntries,
  splitLines,
} from '../../src/lib/build-manifest';
import { boundDirectionOfCell, compareBudgetValues } from '../../src/lib/claims';
import { auditMotionTokens } from '../../src/lib/motion-tokens';
import {
  ACKNOWLEDGED_RESIDUE,
  admitsProjectedLine,
  CITED_READINGS,
  DIGESTS_IN_THE_ARTEFACT,
  digestsIn,
  EXTENSIONLESS_FILES,
  extentOf,
  PROJECTION_BOUNDS,
  PROJECTION_LEAF_PATHS,
  PROJECTION_VOLUME_BOUNDS,
  scanProjectionProse,
} from '../../src/lib/projection-prose';
import { projectionRequest } from '../../src/lib/projection-request';
import { GATES } from '../../src/run';
import {
  GATES_PERMITTED_TO_SKIP_THEN,
  GATES_THAT_SKIPPED,
  SKIP_REASONS,
} from '../../src/lib/skip-accounting';
import {
  digestOf,
  distinctDigestsIn,
  GATES_THAT_READ_THE_PROJECTION,
  integrityOf,
  namesFromDigests,
  PROJECTION_DISTINCT_DIGESTS,
  PROJECTION_FILE,
  PROJECTION_VERSION,
  projectAmendments,
  projectBuild,
  projectFigures,
  projectFromDisk,
  projectStylesheet,
  projectThresholdCell,
  readProjection,
  staleSections,
  writeProjection,
  type AiDocsProjection,
} from '../../src/lib/projection';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The committed reading of `ai-docs/`, and the two things it has to be at once.
 *
 * WHAT THIS FILE IS FOR. Twelve gates skipped on every CI run because the documents they read are
 * in no clone. The artefact is what they read instead, and it has to satisfy two properties that
 * pull against each other: it must answer every question the documents answered, and it must carry
 * nothing anybody wrote. Both are asserted here, and the second is asserted the way a proof of
 * absence has to be, by first showing the subject was there to be absent.
 *
 * WHAT THE SECOND PROPERTY IS AND IS NOT, since this file is where a reader forms the belief. The
 * generator is the guarantee: it reads named fields and writes those. The scan is a backstop, so
 * the cases below fall into two groups and are labelled as such: those that show it catching a
 * mistake, and those that show it bounding volume. A third group, {@link ACKNOWLEDGED_RESIDUE},
 * asserts what it does NOT catch, because a residue nobody wrote down is a residue the next
 * reviewer discovers.
 */

let planted: string | undefined;

afterEach(() => {
  if (planted !== undefined) rmSync(planted, { recursive: true, force: true });
  planted = undefined;
});

const HAVE_AI_DOCS = aiDocsPresent(repoRoot);

/**
 * Every file git tracks, which is the set a claim map proof can cite.
 *
 * @returns Repository relative paths, in the order git lists them
 */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((line) => line.length > 0);
}

/** A tree carrying the documents given, and the artefact generated from them. */
function plant(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'openref-projection-'));
  planted = root;

  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  writeProjection(root, projectFromDisk(root, projectionRequest()));

  return root;
}

/** A minimal plan whose CONTENTS range really does point at its own heading. */
const PLAN = [
  '# BUILD',
  '',
  '**M0 - FOUNDATION**',
  '',
  '- [x] `T001` L0007-L0008 A title nobody outside this repository gets to read',
  '',
  '### T001 [x] A title nobody outside this repository gets to read',
  'Body prose that no gate reads and that must not travel.',
].join('\n');

describe('projectBuild', () => {
  it('should keep the line count, because the whole contract is line addressing', () => {
    // Given a plan of eight lines
    // When
    const surrogate = projectBuild(`${PLAN}\n`);

    // Then
    expect(splitLines(surrogate)).toHaveLength(splitLines(`${PLAN}\n`).length);
  });

  it('should keep every CONTENTS line, its box and its range at its own line number', () => {
    // Given
    const surrogate = splitLines(projectBuild(`${PLAN}\n`));

    // When
    const contents = surrogate[4] ?? '';

    // Then
    expect(contents).toMatch(/^- \[x\] `T001` L0007-L0008 #[0-9a-f]{16}$/);
    expect(surrogate[6]).toMatch(/^### T001 \[x\] #[0-9a-f]{16}$/);
  });

  it('should carry no word of a task title, only a digest that compares like one', () => {
    // Given, and the subject is asserted present before it is asserted absent
    expect(PLAN).toContain('A title nobody outside this repository gets to read');

    // When
    const surrogate = projectBuild(`${PLAN}\n`);

    // Then
    expect(surrogate).not.toContain('A title nobody outside this repository gets to read');
    expect(surrogate).not.toContain('Body prose');
    expect(surrogate).toContain(digestOf('A title nobody outside this repository gets to read'));
  });

  it('should let a title mismatch still fail, which is what the digest has to preserve', () => {
    // Given a plan whose heading title no longer matches its CONTENTS title
    const drifted = PLAN.replace(
      '### T001 [x] A title nobody',
      '### T001 [x] Another title nobody',
    );

    // When
    const issues = checkBuildManifest(projectBuild(`${drifted}\n`), 8, 1);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['title-mismatch']);
  });

  it('should let a shifted range still fail, which is the defect BUILD.md addressing has', () => {
    // Given one line inserted above the task, which moves every range below it
    const shifted = PLAN.replace('# BUILD\n', '# BUILD\n\n');

    // When
    const issues = checkBuildManifest(projectBuild(`${shifted}\n`), 8, 1);

    // Then
    expect(issues.map((issue) => issue.rule).sort()).toEqual(['heading-missing', 'line-count']);
  });
});

describe('projectAmendments', () => {
  it('should keep every heading, so an entry cannot absorb the next one milestone line', () => {
    // Given an entry, a chapter heading, and a milestone line under the chapter rather than the
    // entry. Dropping the chapter heading would re-home that line onto the entry above it.
    const document = [
      '### [ ] `TX-THING` A heading nobody outside this repository gets to read',
      '',
      '## Some chapter with words in it',
      '',
      '**Milestone:** M4 and a sentence after it',
    ].join('\n');

    // When
    const entries = parseOwnedEntries(splitLines(projectAmendments(`${document}\n`)));

    // Then
    expect(entries).toHaveLength(1);
    expect(entries[0]?.milestone).toBeUndefined();
  });

  it('should answer a prefix question through digests, which is how m7 reads its section', () => {
    // Given the shape the declined section heading has
    const document = '### [ ] `T060` Out of scope: a sentence that must not travel\n';

    // When
    const section = parseAmendmentSections(splitLines(projectAmendments(document)))[0];

    // Then, and the subject is asserted present before it is asserted absent
    expect(document).toContain('Out of scope: a sentence that must not travel');
    expect(section?.title).not.toContain('Out of scope');
    expect(section?.title.includes(digestOf('Out of scope'))).toBe(true);
    expect(section?.title.includes(digestOf('Out of nowhere'))).toBe(false);
  });
});

describe('projectThresholdCell', () => {
  it('should keep the bound and drop the paragraphs of history after it', () => {
    // Given a cell in the shape SPEC 20 writes, a bound then a narrative
    // When
    const cell = projectThresholdCell('<= 110 KB, was 108 since T046, measured 109 778 against');

    // Then
    expect(cell).toBe('<= 110 KB');
  });

  it('should keep the recorded-only marker even though it is written after the comma', () => {
    // Given the two rows SPEC 20 gates with nothing
    // When
    const cell = projectThresholdCell('записывается и печатается, порога нет');

    // Then, since dropping it would turn a recorded row into an unreadable threshold
    expect(cell).toBe('порога нет');
  });

  it('should keep a bound the marker is written beside, since two checks read this cell', () => {
    // Given a cell that states a floor AND the recorded-only marker. No SPEC 20 row spells both
    // today, so this is the shape of the function under test rather than a row in the document.
    const cell = '>= 3, порога нет';

    // When
    const projected = projectThresholdCell(cell);

    // Then the projected cell answers the bound question exactly as the document's cell does,
    // and still carries the marker the threshold question is answered from
    expect(boundDirectionOfCell(projected)).toBe(boundDirectionOfCell(cell));
    expect(boundDirectionOfCell(projected)).toBe('at-least');
    expect(projected).toContain('порога нет');
  });

  it('should let an inverted bound still reach budget-bound-inverted through the artefact', () => {
    // Given the failure the collapse suppressed: a table row promising a floor where every budget
    // the gates enforce is a ceiling, projected the way the artefact carries it
    const label = 'a row label nobody outside this repository gets to read';
    const cell = '>= 3, порога нет';
    const row = { label: digestOf(label), threshold: projectThresholdCell(cell) };

    // When
    const issues = compareBudgetValues([row], [], {});

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('budget-bound-inverted');
  });
});

describe('projectFigures', () => {
  it('should keep every figure a claim map row states and no sentence around them', () => {
    // Given a bounds cell in the shape the claim map writes, prose carrying numbers
    const cell = 'The same closure in the bytes the engine compiles, raw, 108 KB since T046';

    // When
    const figures = projectFigures(cell);

    // Then, and the subject is asserted present before it is asserted absent
    expect(cell).toContain('the bytes the engine compiles');
    expect(figures).not.toContain('engine');
    expect(figures).toContain('108 KB');
  });

  it('should keep a thousands separated byte count as the claim map spells it', () => {
    // Given
    // When
    const figures = projectFigures('gzip, 24,900 bytes since T042; was 22,300 through M2');

    // Then
    expect(figures).toContain('24,900 bytes');
    expect(figures).toContain('22,300');
  });
});

describe('projectStylesheet', () => {
  it('should give the motion audit the same verdict as the stylesheet it came from', () => {
    // Given a conforming theme with a colour token whose value must not travel
    const css = [
      ':root {',
      '  --oref-color-accent: #ff00ff;',
      '  --oref-motion-duration-fast: 80ms;',
      '  --oref-motion-duration-base: 160ms;',
      '  --oref-motion-duration-none: 0s;',
      '  --oref-motion-easing-standard: cubic-bezier(0.2, 0, 0.13, 1);',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  :root {',
      '    --oref-motion-duration-fast: var(--oref-motion-duration-none);',
      '    --oref-motion-duration-base: var(--oref-motion-duration-none);',
      '  }',
      '}',
    ].join('\n');

    // When
    const projected = projectStylesheet(css);

    // Then the audit agrees, the token name survives and the colour does not
    expect(auditMotionTokens('planted', [{ file: 'tokens.css', css }])).toEqual([]);
    expect(auditMotionTokens('planted', [{ file: 'tokens.css', css: projected }])).toEqual([]);
    expect(projected).toContain('--oref-color-accent');
    expect(projected).not.toContain('#ff00ff');
  });

  it('should still fail a theme whose reduced motion block does not reach zero', () => {
    // Given the failure this contract exists for, projected
    const css = [
      ':root {',
      '  --oref-motion-duration-fast: 80ms;',
      '  --oref-motion-duration-base: 160ms;',
      '  --oref-motion-duration-none: 0s;',
      '  --oref-motion-easing-standard: linear;',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  :root {',
      '    --oref-motion-duration-fast: 10ms;',
      '  }',
      '}',
    ].join('\n');

    // When
    const findings = auditMotionTokens('planted', [
      { file: 'tokens.css', css: projectStylesheet(css) },
    ]);

    // Then
    expect(findings.map((finding) => finding.reason).join(' ')).toContain('under reduced motion');
  });
});

describe('namesFromDigests', () => {
  it('should print the words a committed constant already carries', () => {
    // Given
    // When
    const names = namesFromDigests([digestOf('детерминизм')], ['детерминизм'], 'the Static row');

    // Then
    expect(names).toEqual(['детерминизм']);
  });

  it('should print the digest and where to look for one nothing committed carries', () => {
    // Given a coverage the specification states and the wiring does not answer
    // When
    const names = namesFromDigests([digestOf('нечто новое')], ['детерминизм'], 'the Static row');

    // Then
    expect(names?.[0]).toContain(digestOf('нечто новое'));
    expect(names?.[0]).toContain('the Static row');
  });
});

/**
 * Every private document, and not the seven the sweep below used to open.
 *
 * IT SWEPT `DEFERRAL_DOCUMENTS`, WHICH WAS SEVEN OF THEM, and the rest outside its subject were
 * the ones nobody would think to check: `design/CONTRACT.md`, the three `tokens.css` the projection
 * actually reads, and the five design notes beside them. A sweep whose subject is a list written
 * for another purpose proves what that list happens to cover.
 *
 * DERIVED FROM THE DIRECTORY RATHER THAN LISTED, so a document added to `ai-docs/` is swept the day
 * it lands. The prototype pages inside each design directory's `html` folder are outside it: they
 * are markup rather than writing, no gate reads one, and their stylesheets share whole declarations
 * with the token sheets by construction, which would make the exemption below meaningless rather
 * than measured.
 *
 * @param root - Absolute repository root
 * @returns Repository relative paths, sorted
 */
function privateDocuments(root: string): string[] {
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'html') walk(path);
        continue;
      }

      if (entry.name.endsWith('.md') || entry.name.endsWith('.css')) {
        found.push(relative(root, path));
      }
    }
  };

  walk(join(root, AI_DOCS_DIR));

  return found.sort();
}

/**
 * The shortest line of a private document the sweep below asks about.
 *
 * IT WAS FORTY AND THE FORTY WAS DOING THE WORK. The sweep asserted that every document line found
 * in the artefact is a line a projected stylesheet may carry, and it passed because at forty
 * characters nothing else reached the artefact at all. Lowered, it fails: at 33 one line arrives,
 * at 10 a second, at 6 a third, and one of the three is `**RELEASE**`, which is a line of the
 * surrogate PLAN and not a stylesheet line at any length. A green a constant is producing is not a
 * green.
 *
 * SIX, JUSTIFIED BY MEASUREMENT, AND WHAT IT EXCLUDES IS PROVED RATHER THAN ASSUMED. Under six
 * characters a document line stops being a line and becomes a fragment that any identifier can
 * contain by coincidence: `{`, `*`, `not`, `it.`, `T018`, `form.`, `],`, `code`, `);` and `}` are
 * the whole of what appears between one and five, measured. The case below asserts that each of
 * them occurs only INSIDE a longer line of the artefact, except `}`, which is itself a line a
 * projected stylesheet may carry. So the floor excludes coincidence and nothing else, and that
 * claim is checked rather than stated.
 */
const SWEEP_FLOOR = 6;

/** Every line the artefact holds, per line values split, so travel is a line and not a substring. */
function artefactLines(artefact: unknown): string[] {
  const lines = new Set<string>();

  const walk = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        lines.add(key);
        walk(item);
      }
      return;
    }
    // Everything that reaches here is a string, a number or a boolean, since JSON holds nothing
    // else and every other shape is handled above.
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const line of text.split('\n')) lines.add(line);
  };

  walk(artefact);

  return [...lines];
}

describe('the committed artefact', () => {
  it.skipIf(!HAVE_AI_DOCS)(
    // The count is read off the directory at collection time rather than written here. It has
    // already been wrong once: the sweep grew from seven documents to every one of them, and a
    // document added to `ai-docs/` afterwards moved it again while this name still said sixteen.
    `should carry no line of any of the ${String(HAVE_AI_DOCS ? privateDocuments(repoRoot).length : 0)} private documents, bar the forms it may carry`,
    () => {
      // Given, and this is the assertion the privacy claim rests on: every substantial line of
      // every private document, taken from the documents themselves rather than from a list.
      // Travel is tested against the artefact's own lines rather than against its raw JSON, so a
      // fragment matched across two values cannot read as a line that travelled.
      const read = readProjection(repoRoot);
      const lines = artefactLines(read.ok ? read.projection : {});
      const documents = privateDocuments(repoRoot);
      const written = new Set<string>();

      for (const file of documents) {
        for (const line of readFileSync(join(repoRoot, file), 'utf8').split('\n')) {
          const trimmed = line.trim();
          if (trimmed.length >= SWEEP_FLOOR) written.add(trimmed);
        }
      }

      // When, the subject asserted present before it is asserted absent, and asserted to be the
      // whole of it: the seven the sweep used to open, plus the nine it did not
      expect(documents).toEqual(expect.arrayContaining([...DEFERRAL_DOCUMENTS]));
      expect(documents).toEqual(
        expect.arrayContaining([
          'ai-docs/design/CONTRACT.md',
          'ai-docs/design/forge/tokens.css',
          'ai-docs/design/telltale/tokens.css',
          'ai-docs/design/vernier/tokens.css',
        ]),
      );
      expect(documents.length).toBeGreaterThanOrEqual(16);
      expect(written.size).toBeGreaterThan(1000);

      // Then every line that travels is a form the projection is allowed to carry: the reduced
      // motion contract, a selector of a list the projected block joins onto one line, or a
      // milestone heading of the surrogate plan. There is more than one so the exemption is
      // measured rather than vacuous.
      const travelled = [...written].filter((line) => lines.some((held) => held.includes(line)));

      expect(travelled.length).toBeGreaterThan(0);
      expect(travelled.filter((line) => !admitsProjectedLine(line))).toEqual([]);
      expect(travelled).toContain('**RELEASE**');
    },
  );

  it.skipIf(!HAVE_AI_DOCS)('should have a floor that excludes coincidence and nothing else', () => {
    // Given every document line SHORTER than the floor that occurs anywhere in the artefact, which
    // is what the floor decides not to ask about
    const read = readProjection(repoRoot);
    const lines = artefactLines(read.ok ? read.projection : {});
    const held = new Set(lines);
    const short = new Set<string>();

    for (const file of privateDocuments(repoRoot)) {
      for (const line of readFileSync(join(repoRoot, file), 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && trimmed.length < SWEEP_FLOOR) short.add(trimmed);
      }
    }

    // When, and the subject is asserted present before it is asserted harmless
    const excluded = [...short].filter((line) => lines.some((one) => one.includes(line)));
    expect(excluded.length).toBeGreaterThan(0);

    // Then each of them either is not a line of the artefact at all, and so occurs only inside a
    // longer line the case above already accounted for, or is itself a line the projection may
    // carry. Neither is a line of a private document arriving unaccounted for.
    expect(excluded.filter((line) => held.has(line) && !admitsProjectedLine(line))).toEqual([]);
  });

  it('should hold nothing that reads as a sentence, in any language, on any checkout', () => {
    // Given the artefact as it ships. It is committed, so this needs no ai-docs/ and runs on a
    // clone, which is the whole reason it exists: the scan against the documents themselves can
    // only run where the documents are, and that is one machine.
    const read = readProjection(repoRoot);
    expect(read.ok).toBe(true);

    // When
    const scan = scanProjectionProse(read.ok ? read.projection : {});

    // Then, and the subject is asserted present before it is asserted absent: a scan that walked
    // nothing reports the same empty list as a scan that walked a clean artefact
    expect(scan.leaves).toBeGreaterThan(500);
    expect(scan.findings).toEqual([]);
  });

  it('should have a grammar for every position it has, and no grammar for a position it lacks', () => {
    // Given the rule table and the artefact it is written against, reconciled in both directions.
    // A position with no rule is admitted in silence, and a rule the artefact never reaches is a
    // grammar nobody would notice going wrong.
    const read = readProjection(repoRoot);

    // When
    const scan = scanProjectionProse(read.ok ? read.projection : {});

    // Then
    expect(scan.paths).toEqual([...PROJECTION_LEAF_PATHS]);
  });

  it('should refuse itself once a hand edits it, on every checkout', () => {
    // Given a copy of the real artefact with one number changed by hand
    const root = mkdtempSync(join(tmpdir(), 'openref-projection-edit-'));
    planted = root;
    const original = JSON.parse(
      readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8'),
    ) as AiDocsProjection;
    const edited: AiDocsProjection = {
      ...original,
      data: { ...original.data, documents: [] },
    };
    mkdirSync(dirname(join(root, PROJECTION_FILE)), { recursive: true });
    writeFileSync(join(root, PROJECTION_FILE), JSON.stringify(edited, null, 2));

    // When
    const read = readProjection(root);

    // Then
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.reason).toContain('edited by hand');
  });

  it('should still load once a hand edits it AND recomputes the digest, which is the honest half', () => {
    // Given the same edit as the case above, this time with the integrity field recomputed. THE
    // DIGEST IS A CORRUPTION CHECK AND NOT A TAMPER CHECK: it is computed from the data beside it
    // with no secret anywhere, so anybody editing on purpose recomputes it. Asserting that here is
    // what stops the shorter claim being made again.
    const root = mkdtempSync(join(tmpdir(), 'openref-projection-resigned-'));
    planted = root;
    const original = JSON.parse(
      readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8'),
    ) as AiDocsProjection;
    const data = { ...original.data, documents: [] };
    writeProjection(root, { ...original, data, integrity: integrityOf(data) });

    // When
    const read = readProjection(root);

    // Then the reader is content, and what refuses the edit is the comparison with the documents
    // and code review, neither of which is this digest
    expect(read.ok).toBe(true);
    expect(read.ok ? read.projection.data.documents : ['x']).toEqual([]);
  });

  it('should be reported missing rather than skipped over', () => {
    // Given a checkout with no artefact at all
    const root = mkdtempSync(join(tmpdir(), 'openref-projection-none-'));
    planted = root;

    // When
    const read = readProjection(root);

    // Then
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.reason).toContain('pnpm gates:projection');
  });

  it('should hash its own contents, so integrity is a property and not a copied field', () => {
    // Given
    const read = readProjection(repoRoot);

    // When, Then
    expect(read.ok).toBe(true);
    expect(read.ok ? integrityOf(read.projection.data) : '').toBe(
      read.ok ? read.projection.integrity : 'x',
    );
  });
});

/**
 * The prose scan, falsified.
 *
 * A CHECK IS WORTH WHAT IT REFUSES. The method this replaces filtered every leaf to Cyrillic and
 * then to a length over forty characters, so three whole classes of leak walked past it: an English
 * sentence, a Russian sentence under forty characters, and a sentence split into two leaves neither
 * of which is over forty on its own. Each of the three is planted below, in a copy of the real
 * artefact, and each is asserted to be exactly what the old method admitted before it is asserted
 * to redden now.
 */
describe('the prose scan, falsified', () => {
  /** The artefact as it ships, parsed fresh, so nothing here can reach the committed file. */
  function artefactCopy(): AiDocsProjection {
    return JSON.parse(readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8')) as AiDocsProjection;
  }

  /** What the method this replaces would have said about one leaf. */
  const admittedByTheOldMethod = (value: string): boolean =>
    !/[Ѐ-ӿ]/u.test(value) || value.length <= 40;

  it('should refuse an English sentence planted in the surrogate plan', () => {
    // Given a sentence with no Cyrillic in it at all, in the one section that carries whole lines
    const sentence = 'The plan owes this task a decision about the runner before M8 opens.';
    const original = artefactCopy();
    const planted: AiDocsProjection = {
      ...original,
      data: {
        ...original.data,
        build: (original.data.build ?? '').replace('\n\n', `\n${sentence}\n`),
      },
    };

    // When, the subject asserted present, and asserted to be what the old method let through
    expect(planted.data.build).toContain(sentence);
    expect(admittedByTheOldMethod(sentence)).toBe(true);
    const scan = scanProjectionProse(planted);

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.build');
    expect(scan.findings[0]?.reason).toContain(sentence);
  });

  it('should refuse a Russian sentence too short for the old length filter', () => {
    // Given seventeen characters of Cyrillic prose, well under the forty the old filter measured
    const sentence = 'ключи не читаются';
    const original = artefactCopy();
    const planted: AiDocsProjection = {
      ...original,
      data: {
        ...original.data,
        spec: {
          ...original.data.spec,
          budgetRows: (original.data.spec.budgetRows ?? []).map((row, at) =>
            at === 0 ? { ...row, threshold: sentence } : row,
          ),
        },
      },
    };

    // When, the subject asserted present, and asserted to be what the old method let through
    expect(sentence.length).toBeLessThan(40);
    expect(/[Ѐ-ӿ]/u.test(sentence)).toBe(true);
    expect(admittedByTheOldMethod(sentence)).toBe(true);
    const scan = scanProjectionProse(planted);

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.spec.budgetRows[].threshold');
    expect(scan.findings[0]?.value).toBe(sentence);
  });

  it('should refuse both halves of a sentence split across two adjacent leaves', () => {
    // Given one sentence cut in two, each half short enough and each half sitting in its own leaf,
    // which is the shape a per leaf length filter cannot see at any threshold
    const halves = ['Каждая строка плана', 'уезжает в артефакт целиком'];
    const original = artefactCopy();
    const planted: AiDocsProjection = {
      ...original,
      data: {
        ...original.data,
        claimMap: (original.data.claimMap ?? []).map((row, at) =>
          at < halves.length ? { ...row, text: halves[at] ?? '' } : row,
        ),
      },
    };

    // When, the subject asserted present, and asserted to be what the old method let through
    expect(halves.every((half) => admittedByTheOldMethod(half))).toBe(true);
    const scan = scanProjectionProse(planted);

    // Then both halves are reported, not just the first
    expect(scan.findings.map((finding) => finding.value)).toEqual(halves);
    expect(new Set(scan.findings.map((finding) => finding.path))).toEqual(
      new Set(['data.claimMap[].text']),
    );
  });

  it('should refuse a leaf at a position no rule names, whatever it holds', () => {
    // Given a field added to the artefact and to nothing else, which is how the next leak arrives
    const original = artefactCopy();
    const planted = {
      ...original,
      data: { ...original.data, note: 'A note the generator started keeping.' },
    };

    // When
    const scan = scanProjectionProse(planted);

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.note');
    expect(scan.findings[0]?.reason).toContain('no rule names');
  });

  /**
   * The nine the second review planted and the scan admitted, each red here.
   *
   * TWO DEFECTS PRODUCED ALL NINE. A KEY IS A LEAF and was not judged, so a name carrying a
   * sentence was invisible whenever the value beside it was null or empty, and invisible to the
   * census that reconciles the rule table with the artefact as well, in both directions at once.
   * And THE SCAN TREATED THE SEPARATOR AS IF IT WERE THE MEANING: every identifier grammar here
   * admits an unbounded run of hyphens, dots or camel humps, and a sentence written that way is
   * still a sentence.
   */

  it('should refuse a KEY carrying a sentence, with null beside it', () => {
    // Given the shape the whole census missed: the sentence is the NAME, and the value beside it is
    // a null, which the walk used to return on before anything was judged or counted
    const sentence = 'The plan owes this task a decision about the runner before M8 opens.';
    const original = artefactCopy();
    const planted = {
      ...original,
      data: { ...original.data, [sentence]: null },
    };

    // When, the subject asserted present
    expect(Object.keys(planted.data)).toContain(sentence);
    const scan = scanProjectionProse(planted);

    // Then, and the path is where the leak is, so the path carries it
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe(`data.${sentence}`);
    expect(scan.findings[0]?.reason).toContain('no rule names');
  });

  it('should refuse a Cyrillic KEY carrying a sentence, with an empty array beside it', () => {
    // Given the same defect through the other shape that holds nothing
    const sentence = 'Ключи не читаются, и это тоже уезжает в артефакт';
    const original = artefactCopy();
    const planted = {
      ...original,
      data: { ...original.data, [sentence]: [] },
    };

    // When, the subject asserted present
    expect(Object.keys(planted.data)).toContain(sentence);
    const scan = scanProjectionProse(planted);

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe(`data.${sentence}`);
    expect(scan.findings[0]?.value).toBe('empty array');
  });

  it('should refuse a boolean, which used to be admitted at any position with no lookup', () => {
    // Given a boolean where the surrogate plan belongs. The walk counted it, called it a box and
    // never asked the rule table anything, so a boolean was admitted at every position in the file
    const original = artefactCopy();
    const planted = { ...original, data: { ...original.data, build: true } };

    // When
    const scan = scanProjectionProse(planted);

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.build');
    expect(scan.findings[0]?.reason).toContain('is boolean where this position holds');
  });

  it('should refuse a hyphenated sentence as a claim id, and admit a real one', () => {
    // Given a sentence written with hyphens instead of spaces. The grammar for this position is a
    // lowercase hyphenated identifier and admits it at any length, which is why the bound exists.
    const sentence = 'the-maintainer-ruled-the-runner-ships-without-the-proxy-in-m8';
    const original = artefactCopy();
    const planted = (id: string): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        claimMap: (original.data.claimMap ?? []).map((row, at) =>
          at === 0 ? { ...row, id } : row,
        ),
      },
    });

    // When, and the spelling is asserted admitted before the reach is asserted refused: the same
    // characters in a real id scan clean, so the finding below is the bound and not the grammar
    expect(scanProjectionProse(planted('the-runner-ships')).findings).toEqual([]);
    const scan = scanProjectionProse(planted(sentence));

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.claimMap[].id');
    expect(scan.findings[0]?.reason).toContain('reaches 61 characters against a bound of 48');
  });

  it('should refuse a hyphenated sentence as a custom property name', () => {
    // Given a declaration the stylesheet grammar admits in full: an inert value on a property whose
    // name is a sentence. `--oref-motion-duration-fast` is the real shape, and the bound is what
    // tells the two apart.
    const sentence = '--the-maintainer-ruled-that-federation-ships-without-the-runner: 0;';
    const original = artefactCopy();
    const planted = (declaration: string): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        stylesheets: original.data.stylesheets.map((sheet, at) => {
          if (at !== 0) return sheet;
          const lines = (sheet.css ?? '').split('\n');
          lines.splice(1, 0, declaration);
          return { ...sheet, css: lines.join('\n') };
        }),
      },
    });

    // When, the spelling asserted admitted first
    expect(scanProjectionProse(planted('--oref-motion-duration-slow: 0;')).findings).toEqual([]);
    const scan = scanProjectionProse(planted(sentence));

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.stylesheets[].css');
    expect(scan.findings[0]?.reason).toContain('packs 9 segments into one token');
  });

  it('should refuse a hyphenated sentence as a reader page route', () => {
    // Given SPEC 13.3's route grammar, which admits a hyphenated segment of any length
    const sentence = '<route>/the-maintainer-ruled-that-federation-ships-without-the-runner';
    const original = artefactCopy();
    const planted = (route: string): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        spec: {
          ...original.data.spec,
          readerPages: (original.data.spec.readerPages ?? []).map((page, at) =>
            at === 0 ? route : page,
          ),
        },
      },
    });

    // When, the spelling asserted admitted first
    expect(scanProjectionProse(planted('<route>/sign-in')).findings).toEqual([]);
    const scan = scanProjectionProse(planted(sentence));

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.spec.readerPages[]');
    expect(scan.findings[0]?.reason).toContain('reaches 69 characters against a bound of 64');
  });

  it('should refuse a hyphenated sentence as a published package name', () => {
    // Given the scope grammar, which admits any hyphenated name after the slash
    const sentence = '@openref/the-maintainer-ruled-that-federation-ships-without-the-runner';
    const original = artefactCopy();
    const packages = original.data.spec.packages;
    const planted = (name: string): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        spec: {
          ...original.data.spec,
          packages:
            packages === null
              ? null
              : {
                  ...packages,
                  published: packages.published.map((one, at) => (at === 0 ? name : one)),
                },
        },
      },
    });

    // When, the spelling asserted admitted first
    expect(scanProjectionProse(planted('@openref/theme-forge')).findings).toEqual([]);
    const scan = scanProjectionProse(planted(sentence));

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.spec.packages.published[]');
    expect(scan.findings[0]?.reason).toContain('reaches 70 characters against a bound of 48');
  });

  it('should refuse a dot separated sentence as a file name, at a repository path', () => {
    // Given the loosest position in the file, and it got looser in this round rather than tighter:
    // `packages/core/test/corpus/snapshots/oai-3.2-query-example.yaml.ir.json` is a file in this
    // repository whose last token packs exactly 8 segments, which was the bound, so one more dot
    // part in a corpus snapshot name reddened an honest tree. The bound is 12 and the sentence has
    // to be written longer to get past it. What closes the rest of this position is the `claims`
    // gate, which refuses a proof naming no file on disk.
    const sentence =
      'packages/core/src/the.maintainer.ruled.that.federation.ships.without.the.runner.and.the.proxy.ts';
    const original = artefactCopy();
    const planted = (proof: string): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        claimMap: (original.data.claimMap ?? []).map((row, at) =>
          at === 0 ? { ...row, proofs: [proof] } : row,
        ),
      },
    });

    // When, the spelling asserted admitted first, and the corpus snapshot name that used to sit on
    // the bound with nothing above it asserted admitted beside it
    expect(scanProjectionProse(planted('packages/core/src/hashing/canonical.ts')).findings).toEqual(
      [],
    );
    expect(
      scanProjectionProse(
        planted('packages/core/test/corpus/snapshots/oai-3.2-query-example.yaml.ir.json'),
      ).findings,
    ).toEqual([]);
    const scan = scanProjectionProse(planted(sentence));

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.claimMap[].proofs[]');
    expect(scan.findings[0]?.reason).toContain(
      'packs 13 segments into one token against a bound of 12',
    );
  });

  it('should refuse a camel humped sentence as a SPEC 21 row KEY', () => {
    // Given a dynamic key, which the scan did judge and did not bound: the row label grammar is
    // `[A-Z][A-Za-z]*` and a camel humped sentence is exactly that
    const sentence = 'TheMaintainerRuledThatTheRunnerShipsWithoutTheProxy';
    const original = artefactCopy();
    const planted = (row: string): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        spec: {
          ...original.data.spec,
          suiteRows: { ...original.data.spec.suiteRows, [row]: [] },
        },
      },
    });

    // When, the spelling asserted admitted first
    expect(scanProjectionProse(planted('Shapes')).findings).toEqual([]);
    const scan = scanProjectionProse(planted(sentence));

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.spec.suiteRows.*');
    expect(scan.findings[0]?.value).toBe(sentence);
  });
});

/**
 * The segmenter, falsified on the run of capitals it could not divide.
 *
 * `segmentsOfToken` BREAKS A CAMEL HUMP BY FINDING A CAPITAL WITH A LOWERCASE AFTER IT, so a run of
 * capitals has no hump in it and counts as ONE segment at any word count. Four words of capitals
 * measured 1 segment and 1 per token and walked past every segment bound in the file, and the
 * position it walked past is reachable in practice, because `**RELEASE**` travels verbatim. The old
 * rule is reproduced below and asserted to admit the plant before the plant is asserted refused.
 */
describe('the segmenter, falsified', () => {
  /** What the segmenter this replaces counted, camel humps only. */
  const segmentedByTheOldMethod = (token: string): number =>
    token
      .split(/[._-]+/u)
      .flatMap((part) =>
        part
          .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
          .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
          .split(' '),
      )
      .filter((segment) => segment.length > 0).length;

  it('should measure a run of capitals the segmenter cannot divide', () => {
    // Given four words written in capitals, which is one token with no hump in it
    const run = 'DROPTELLTALEBEFOREM8';

    // When, and the old count is asserted first, because it is the defect
    expect(segmentedByTheOldMethod(run)).toBe(1);

    // Then the run is measured rather than segmented, since nothing can find the word breaks
    expect(extentOf(run).segments).toBe(1);
    // The trailing digit is not a letter, so the run the measure sees is the nineteen before it
    expect(extentOf(run).capitals).toBe(19);
  });

  it('should refuse a milestone heading written as four words in capitals', () => {
    // Given the position the run reaches, which is the one that carries `**RELEASE**` verbatim
    const original = JSON.parse(
      readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8'),
    ) as AiDocsProjection;
    const planted = (heading: string): AiDocsProjection => {
      const lines = (original.data.build ?? '').split('\n');
      lines[1] = heading;
      return { ...original, data: { ...original.data, build: lines.join('\n') } };
    };

    // When, the real milestone heading asserted admitted first, so the finding is the run and not
    // the shape
    expect(scanProjectionProse(planted('**RELEASE**')).findings).toEqual([]);
    const scan = scanProjectionProse(planted('**DROPTELLTALEBEFOREM8**'));

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.build');
    expect(scan.findings[0]?.reason).toContain('**DROPTELLTALEBEFOREM8**');
  });

  it('should refuse a shorter run at a position whose vocabulary cannot be enumerated', () => {
    // Given a `TX-` id, where the grammar is `TX-[A-Z-]+` and no list can close it, so the
    // capitals bound is the only thing that measures the run
    const original = JSON.parse(
      readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8'),
    ) as AiDocsProjection;
    const planted = (entry: string): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        markers: original.data.markers.map((marker, at) =>
          at === 0 ? { ...marker, entry } : marker,
        ),
      },
    });

    // When, a real compound `TX-` name asserted admitted first. THE PLANT MOVED IN THIS ROUND AND
    // THE MOVE IS THE POINT: it used to be `TX-NOPROXYUNTILM8`, fourteen capitals against a bound
    // of twelve, and that bound also refused `TX-REDUCEDMOTION-CONTRACT`, which is thirteen and is
    // an id this project could write next week. Worse, the amendment line carrying the same id
    // bounded capitals at sixteen, so one id was admitted as a line and refused as the id inside
    // it. The bound now follows the kind at all three positions, so the plant has to be a run no
    // `TX-` name would be, and the case still measures the thing no segmenter can divide.
    expect(segmentedByTheOldMethod('NOPROXYUNTILRELEASE')).toBe(1);
    expect(scanProjectionProse(planted('TX-GLOBALGUARD')).findings).toEqual([]);
    expect(scanProjectionProse(planted('TX-REDUCEDMOTION-CONTRACT')).findings).toEqual([]);
    const scan = scanProjectionProse(planted('TX-NOPROXYUNTILRELEASE'));

    // Then
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.markers[].entry');
    expect(scan.findings[0]?.reason).toContain(
      'capitals in one unbroken run against a bound of 16',
    );
  });

  it('should refuse the digits a `TX-` id used to be able to carry', () => {
    // Given the id that used to be this file's plant, which the grammar now refuses before any
    // bound is applied: `OWNED_ENTRY_LINE` in the generator writes `TX-[A-Z-]+`, and a grammar
    // looser than the generator it reads is room nobody asked for
    const original = JSON.parse(
      readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8'),
    ) as AiDocsProjection;
    const planted = (entry: string): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        markers: original.data.markers.map((marker, at) =>
          at === 0 ? { ...marker, entry } : marker,
        ),
      },
    });

    // When, the two real spellings asserted admitted first, one of each half of the grammar
    expect(scanProjectionProse(planted('TX-SURFACE-REGISTER')).findings).toEqual([]);
    expect(scanProjectionProse(planted('T011-R2')).findings).toEqual([]);
    const digits = scanProjectionProse(planted('TX-NOPROXYUNTILM8'));
    const revision = scanProjectionProse(planted('T011-R12345678901234567890'));

    // Then
    expect(digits.findings).toHaveLength(1);
    expect(digits.findings[0]?.reason).toContain('is not an amendment entry id');
    expect(revision.findings).toHaveLength(1);
    expect(revision.findings[0]?.reason).toContain('is not an amendment entry id');
  });
});

/**
 * The digit channel, falsified at every position that carried one.
 *
 * TWO THIRDS OF THE REVIEWER'S 4.72 MB WERE DIGITS, 3,023,605 characters of them, and every one sat
 * inside its position's character bound. A character bound counts a digit as one character, so a
 * grammar admitting an unbounded run of them is a channel that no length can close: `M\d+` took 80
 * digits inside a 96 character amendment line, `T\d{3}-R\d*` took 80 more, and one claim map figure
 * took 800. Each case below asserts the real spelling admitted before it asserts the run refused.
 */
describe('the digit channel, falsified', () => {
  function artefactCopy(): AiDocsProjection {
    return JSON.parse(readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8')) as AiDocsProjection;
  }

  const digits = (count: number): string => '9'.repeat(count);

  it('should bound a milestone to the enumerated kind, wherever a milestone appears', () => {
    // Given the four positions a milestone id reaches: the plan's own heading, the amendment
    // milestone line, a marker, and the owner a marker records
    const original = artefactCopy();
    const planLine = (heading: string): AiDocsProjection => {
      const lines = (original.data.build ?? '').split('\n');
      lines[1] = heading;
      return { ...original, data: { ...original.data, build: lines.join('\n') } };
    };
    const amendmentLine = (line: string): AiDocsProjection => {
      const lines = (original.data.amendments ?? '').split('\n');
      const at = lines.findIndex((one) => one.startsWith('**Milestone:**'));
      lines[at] = line;
      return { ...original, data: { ...original.data, amendments: lines.join('\n') } };
    };
    const marker = (fields: Partial<(typeof original.data.markers)[number]>): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        markers: original.data.markers.map((one, at) => (at === 0 ? { ...one, ...fields } : one)),
      },
    });

    // When, the real spellings asserted admitted first
    expect(scanProjectionProse(planLine('**RELEASE**')).findings).toEqual([]);
    expect(scanProjectionProse(amendmentLine('**Milestone:** M7')).findings).toEqual([]);
    expect(scanProjectionProse(marker({ text: '(с M5)', owner: 'M5' })).findings).toEqual([]);

    // Then a run of digits is refused at every one of them, and the refusal is the grammar rather
    // than a length, which is what makes it closed instead of merely bounded
    for (const artefact of [
      planLine(`**M${digits(43)}**`),
      amendmentLine(`**Milestone:** M${digits(80)}`),
      marker({ text: `(M${digits(61)})` }),
      marker({ owner: `M${digits(11)}` }),
      marker({ owner: 'M999' }),
    ]) {
      expect(scanProjectionProse(artefact).findings).toHaveLength(1);
    }
  });

  it('should bound a figure to a figure, and the figures in a row to a table', () => {
    // Given the claim map cell, which states measurements and is projected as figures alone
    const original = artefactCopy();
    const planted = (text: string): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        claimMap: (original.data.claimMap ?? []).map((row, at) =>
          at === 0 ? { ...row, text } : row,
        ),
      },
    });

    // When, the real spellings asserted admitted first: a separated byte count, a decimal, a
    // figure with a unit, and the trailing comma the cell wrote after one
    expect(
      scanProjectionProse(planted('109,778 ; 95.86 ; 156,672 bytes ; 108,544, ; 2 с')).findings,
    ).toEqual([]);

    const run = scanProjectionProse(planted(digits(800)));
    const many = scanProjectionProse(planted(Array.from({ length: 137 }, () => '9').join(' ; ')));

    // Then
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]?.reason).toContain('is not figures');
    expect(many.findings).toHaveLength(1);
    expect(many.findings[0]?.reason).toContain('states 137 figures against a bound of 136');
  });

  it('should permit one digest a plan line, which is what a plan line can carry', () => {
    // Given the surrogate plan, whose four line forms each carry at most one digest. The position
    // permitted two, which was slack no grammar here could reach, so the second permitted a
    // repetition rather than a value.
    const original = artefactCopy();
    const planted = (line: string): AiDocsProjection => {
      const lines = (original.data.build ?? '').split('\n');
      const at = lines.findIndex((one) => one.startsWith('- ['));
      lines[at] = line;
      return { ...original, data: { ...original.data, build: lines.join('\n') } };
    };

    // When, the real line asserted admitted first
    expect(
      scanProjectionProse(planted('- [x] `T001` L0171-L0196 #0123456789abcdef')).findings,
    ).toEqual([]);
    const scan = scanProjectionProse(
      planted('- [x] `T001` L0171-L0196 #0123456789abcdef #0123456789abcdee'),
    );

    // Then, and it is the grammar that refuses this one, since no plan line form repeats a digest
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.path).toBe('data.build');
  });

  it('should finish in a moment on the value that used to make the pattern backtrack', () => {
    // Given the shape that hung the first attempt at this bound. `FIGURE(?: ; FIGURE){0,135}` is a
    // repetition of an ambiguous alternation, so a value it must REFUSE made the engine try every
    // parse: 400 one digit figures did not finish in ten minutes. The count is read in code now.
    const started = performance.now();

    // When
    const scan = scanProjectionProse({
      data: { claimMap: [{ text: Array.from({ length: 400 }, () => '9').join(' ; ') }] },
    });

    // Then
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(scan.findings).toHaveLength(1);
  });
});

/**
 * The volume of what travels, which no rule about one value can see.
 *
 * A THOUSAND CONFORMING LINES ARE A THOUSAND CONFORMING LINES. Each one passes its grammar and each
 * one is inside its bound, and twelve thousand words arrive anyway. The same holds for the digests:
 * eight unreadable bytes each, repeated without limit, is a channel rather than a slip. Every case
 * below plants a repetition of values that are individually in order.
 */
describe('the volume of the artefact', () => {
  function artefactCopy(): AiDocsProjection {
    return JSON.parse(readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8')) as AiDocsProjection;
  }

  it('should refuse a thousand conforming lines appended to a stylesheet', () => {
    // Given the declaration the reviewer appended a thousand times, each one an inert custom
    // property that every per value rule admits
    const line = '--one-two-three-four-five-six: var(--seven-eight-nine-ten-eleven-twelve);';
    const original = artefactCopy();
    const planted = (times: number): AiDocsProjection => ({
      ...original,
      data: {
        ...original.data,
        stylesheets: original.data.stylesheets.map((sheet, at) => {
          if (at !== 0) return sheet;
          const lines = (sheet.css ?? '').split('\n');
          lines.splice(1, 0, ...Array.from({ length: times }, () => line));
          return { ...sheet, css: lines.join('\n') };
        }),
      },
    });

    // When, one copy asserted admitted first, so the finding is the repetition and not the line
    expect(scanProjectionProse(planted(1)).findings).toEqual([]);
    const scan = scanProjectionProse(planted(1000));

    // Then TWO bounds report and both are true of this plant: the lines in one value, and the
    // weight of the file, which is the bound that exists because per position bounds multiply
    expect(scan.findings.map((finding) => [finding.rule, finding.path])).toEqual([
      ['volume-exceeded', 'data.stylesheets[].css'],
      ['volume-exceeded', 'the whole artefact'],
    ]);
    expect(scan.findings[0]?.reason).toContain('lines in one value against a bound of 800');
    expect(scan.findings[1]?.reason).toContain(
      `bytes against a budget of ${String(PROJECTION_ARTEFACT_BUDGET.limitBytes)}`,
    );
  });

  it('should refuse a surrogate plan grown past what a plan can be', () => {
    // Given the plan padded with empty lines, every one of which the grammar admits
    const original = artefactCopy();
    const scan = scanProjectionProse({
      ...original,
      data: { ...original.data, build: `${original.data.build ?? ''}${'\n'.repeat(100_000)}` },
    });

    // When, Then, and the file budget reports beside it because 100,000 empty lines weigh
    // something even though not one of them holds a character
    expect(scan.findings.map((finding) => [finding.rule, finding.path])).toEqual([
      ['volume-exceeded', 'data.build'],
      ['volume-exceeded', 'the whole artefact'],
    ]);
    expect(scan.findings[0]?.reason).toContain('lines in one value against a bound of 6000');
  });

  it('should refuse an amendment heading carrying more digests than a heading has prefixes', () => {
    // Given the covert channel the reviewer measured: a digest is eight bytes nobody can read, the
    // heading grammar repeats one without limit, and the strip before measurement removes them all
    const original = artefactCopy();
    const lines = (original.data.amendments ?? '').split('\n');
    const at = lines.findIndex((line) => /^### \[[ x]\] `T\d{3}`/u.test(line));
    expect(at).toBeGreaterThan(-1);
    lines[at] = `${lines[at] ?? ''}${' #0123456789abcdef'.repeat(20_000)}`;

    // When
    const scan = scanProjectionProse({
      ...original,
      data: { ...original.data, amendments: lines.join('\n') },
    });

    // Then every bound this passed reports, and there are three: the repetition on one line, the
    // weight of the file, and the number of digests it may carry. THE ORDER IS THE POINT OF THE
    // MIDDLE ONE: 20,000 digests weigh 340,000 bytes, so the file budget is what a reader sees
    // first, and the digest count is the diagnostic beside it rather than the thing holding the
    // line.
    expect(scan.findings.map((finding) => [finding.rule, finding.path])).toEqual([
      ['leaf-refused', 'data.amendments'],
      ['volume-exceeded', 'the whole artefact'],
      ['volume-exceeded', 'the whole artefact'],
    ]);
    expect(scan.findings[0]?.reason).toContain('digests against a bound of 200');
    expect(scan.findings[1]?.reason).toContain(
      `bytes against a budget of ${String(PROJECTION_ARTEFACT_BUDGET.limitBytes)}`,
    );
    expect(scan.findings[2]?.reason).toContain(
      `against a bound of ${String(DIGESTS_IN_THE_ARTEFACT)}`,
    );
  });

  it('should refuse more rows, or more stylesheets, than the artefact can have', () => {
    // Given the same row and the same sheet repeated, each copy conforming
    const original = artefactCopy();
    const rows = [...(original.data.claimMap ?? [])];
    const row = rows[0];
    while (row !== undefined && rows.length < 5_000) rows.push(row);
    const sheets = [...original.data.stylesheets];
    const sheet = sheets[0];
    while (sheet !== undefined && sheets.length < 40) sheets.push(sheet);

    // When
    const many = scanProjectionProse({ ...original, data: { ...original.data, claimMap: rows } });
    const sheeted = scanProjectionProse({
      ...original,
      data: { ...original.data, stylesheets: sheets },
    });

    // Then
    expect(many.findings.map((finding) => finding.reason).join(' ')).toContain(
      'leaves against a bound of 400',
    );
    expect(sheeted.findings.map((finding) => finding.reason).join(' ')).toContain(
      'leaves against a bound of 12',
    );
  });

  it('should count only what a digest is, so a longer hex run is not a digest', () => {
    // Given the shape the strip before measurement used to hide: thirty two hex characters lose
    // their first sixteen to it and pass as one short token. Every position that may hold a digest
    // anchors its grammar, so this cannot be reached through the artefact today, and the function
    // is falsified directly rather than through a plant that no grammar admits.
    // When
    const real = digestsIn('### [x] `T001` #0123456789abcdef');
    const doubled = digestsIn('#0123456789abcdef0123456789abcdef');
    const shouting = digestsIn('#0123456789ABCDEF');

    // Then
    expect(real).toEqual({ count: 1, wrong: [] });
    expect(doubled.count).toBe(0);
    expect(doubled.wrong).toEqual(['#0123456789abcdef0123456789abcdef']);
    expect(shouting.wrong).toEqual(['#0123456789ABCDEF']);
  });

  it('should refuse the payload every per position bound admits, on the file budget', () => {
    // Given the artefact rebuilt at the volume BOUNDS of three positions rather than at their
    // readings, with every value one the grammar admits: twelve stylesheets of 400 conforming
    // declarations, 400 claim map rows of five proof paths each, and a surrogate plan of 6,000
    // conforming lines. THIS IS THE REVIEWER'S FINDING IN MINIATURE AND ITS OWN FIGURES ARE ITS
    // OWN: 378,431 bytes over 3,627 leaves, asserted below, and this comment used to hand it the
    // 4,725,296 bytes of the full fill instead. What the full fill IS, is the leaf bound of every
    // position added up, and that half is derived here rather than remembered.
    const line = '--one-two-three-four-five-six: 0;';
    const proof = 'packages/core/src/hashing/canonical.ts';
    const payload = {
      version: 1,
      data: {
        build: `${Array.from({ length: 6_000 }, () => '**M7**').join('\n')}\n`,
        stylesheets: Array.from({ length: 12 }, () => ({
          file: proof,
          css: Array.from({ length: 400 }, () => line).join('\n'),
        })),
        claimMap: Array.from({ length: 400 }, () => ({
          id: 'client-js',
          text: '',
          proofs: Array.from({ length: 5 }, () => proof),
          status: 'proved',
          quoted: '',
        })),
      },
      integrity: '#0123456789abcdef',
    };

    // When
    const scan = scanProjectionProse(payload);

    // Then, and the subject is asserted present before it is asserted caught: NOT ONE POSITION IS
    // OVER, which is exactly why a per position rule could never have seen this
    expect(scan.findings.filter((finding) => finding.path !== 'the whole artefact')).toEqual([]);
    expect(scan.findings.map((finding) => finding.rule)).toEqual([
      'volume-exceeded',
      'volume-exceeded',
    ]);
    expect(scan.bytes).toBeGreaterThan(PROJECTION_ARTEFACT_BUDGET.limitBytes);
    expect(scan.leaves).toBeGreaterThan(PROJECTION_ARTEFACT_BUDGET.leaves);
    expect([scan.bytes, scan.leaves]).toEqual([378_431, 3_627]);

    // And the 6,880 leaves that four files state about the full fill is the sum of the leaf bounds
    // themselves, so that figure is a derivation rather than a memory of one afternoon. It read
    // 6,840 until 2026-09-04, when `data.spec.packages.heldBack[]` was governed alongside its three
    // sibling package positions at the same 40 leaves; a position gaining a grammar raises this sum
    // by construction, and the artefact budget of 800 leaves, which is what actually refuses a full
    // fill, has not moved.
    expect(
      Object.values(PROJECTION_VOLUME_BOUNDS).reduce((total, room) => total + room.leaves, 0),
    ).toBe(6_880);

    // And the leaf overrun says what to do about itself. THE NEXT PERSON TO MEET THIS MESSAGE IS
    // ADDING CLAIM MAP ROWS, and the cheapest thing they can do is raise the number, so the number
    // is not the last word the message leaves them with.
    const overrun = scan.findings.find((finding) => finding.value.endsWith('leaves'))?.reason ?? '';
    expect(overrun).toContain(`floor is ${String(PROJECTION_LEAF_FLOOR)}`);
    expect(overrun).toContain('the committed reading sits between the two');
    expect(overrun).toContain('pricing a milestone off the artefact');
    expect(overrun).toContain('never to raise it to fit the reading that just went red');
  });

  it('should hold the committed artefact under the file budget, with the headroom it states', () => {
    // Given the artefact as it ships, weighed as the file rather than as a re-serialization of it
    const read = readProjection(repoRoot);
    expect(read.ok).toBe(true);
    const bytes = read.ok ? read.bytes : 0;

    // When
    const scan = scanProjectionProse(read.ok ? read.projection : {}, bytes);

    // Then the reading is real, is under both budgets, and the headroom is the one the budget's
    // own derivation claims: two milestones of ordinary writing at the measured 8,118 bytes each
    expect(scan.bytes).toBe(bytes);
    expect(scan.bytes).toBeGreaterThan(100_000);
    expect(scan.findings).toEqual([]);
    expect(PROJECTION_ARTEFACT_BUDGET.limitBytes - scan.bytes).toBeGreaterThan(2 * 8_118);
    expect(PROJECTION_ARTEFACT_BUDGET.leaves - scan.leaves).toBeGreaterThan(0);
  });

  it('should carry fewer digests than the whole file is allowed', () => {
    // Given the artefact as it ships, which is where the bound has to leave room
    const read = readProjection(repoRoot);

    // When
    const scan = scanProjectionProse(read.ok ? read.projection : {});

    // Then, and the reading is asserted real before it is asserted inside the bound
    expect(scan.digests).toBeGreaterThan(2_000);
    expect(scan.digests).toBeLessThan(DIGESTS_IN_THE_ARTEFACT);
  });
});

/**
 * Every bound, against the honest work it has to admit and the reading it has to hold.
 *
 * THE BOUNDS ARE SIZED TO WHAT A KIND CAN BE, NOT TO WHAT THE ARTEFACT HOLDS. That is the ruling
 * this round is written to, and it is checked from both ends. From below, the reading the committed
 * artefact gives is inside every bound, so a document that grows past one is red and the answer is
 * to look at what grew. From above, each value the review named as ordinary future work is planted
 * and asserted GREEN, because a privacy check that reddens on honest work gets edited away and then
 * it protects nothing.
 */
describe('every bound, and the honest work it has to admit', () => {
  function artefactCopy(): AiDocsProjection {
    return JSON.parse(readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8')) as AiDocsProjection;
  }

  it('should hold the committed artefact inside every bound it declares', () => {
    // Given the artefact, measured by the same walk that enforces the bounds
    const read = readProjection(repoRoot);
    expect(read.ok).toBe(true);

    // When
    const scan = scanProjectionProse(read.ok ? read.projection : {});

    // Then every position was reached and every reading is inside its bound and its volume
    expect(Object.keys(scan.reach).length).toBe(PROJECTION_LEAF_PATHS.length);

    for (const path of PROJECTION_LEAF_PATHS) {
      const reach = scan.reach[path];
      const bound = PROJECTION_BOUNDS[path];
      const seen = scan.volume[path];
      const room = PROJECTION_VOLUME_BOUNDS[path];

      expect([path, reach !== undefined, bound !== undefined]).toEqual([path, true, true]);
      expect([path, (reach?.chars ?? 0) <= (bound?.chars ?? 0)]).toEqual([path, true]);
      expect([path, (reach?.segments ?? 0) <= (bound?.segments ?? 0)]).toEqual([path, true]);
      expect([path, (reach?.perToken ?? 0) <= (bound?.perToken ?? 0)]).toEqual([path, true]);
      expect([path, (reach?.capitals ?? 0) <= (bound?.capitals ?? 0)]).toEqual([path, true]);
      expect([path, (seen?.leaves ?? 0) <= (room?.leaves ?? 0)]).toEqual([path, true]);
    }
  });

  it('should admit the paths this repository has, measured over the tracked files', () => {
    // Given every file git tracks, which is what a claim map proof can cite, and the position that
    // holds one. THE GRAMMAR WAS REFUSING 53 OF THEM, among them every corpus snapshot, because a
    // dotted name part carrying a hyphen was not a name part, and every dotfile, because a name
    // could not begin with a dot. A proof citing one was red for being a path this repository
    // writes, which is the shape of false positive this whole round is about. Then it refused 23
    // more, every one of them extensionless, and this case is what measures that there are none.
    const tracked = trackedFiles();

    // When each one is planted as a proof path
    const refused = tracked.filter(
      (file) =>
        scanProjectionProse({ data: { claimMap: [{ proofs: [file] }] } }).findings.length > 0,
    );

    // Then the subject is real, and NOT ONE tracked file is refused. The count is asserted rather
    // than a class named, because the two classes this position refused before were each found by
    // measuring and not by thinking about it.
    expect(tracked.length).toBeGreaterThan(1_000);
    expect(refused).toEqual([]);
  });

  it('should admit an extensionless file it tracks and still refuse a bare word', () => {
    // Given the class that was refused outright until this round, and the hole the dot rule was
    // defending against. THIS IS THE FALSE NEGATIVE THAT MATTERED: this project found that no
    // published package shipped a LICENSE and fixed it, so a claim whose proof IS a LICENSE file
    // is exactly what gets written next, and the grammar could not express it.
    const proof = (path: string): unknown => ({ data: { claimMap: [{ proofs: [path] }] } });

    // When the two extensionless names this repository actually writes are planted, at the root
    // and inside a package, and a bare word that is not a file is planted beside them
    const licence = scanProjectionProse(proof('packages/core/LICENSE'));
    const root = scanProjectionProse(proof('LICENSE'));
    const notice = scanProjectionProse(proof('packages/core/test/corpus/NOTICE'));
    const word = scanProjectionProse(proof('CHANGELOG'));
    const sentence = scanProjectionProse(proof('the-runner-ships-without-the-proxy'));
    const shouting = scanProjectionProse(proof('DROPTELLTALEBEFOREM8'));

    // Then the files this repository has are proofs, and a bare word is still not a path
    expect(licence.findings).toEqual([]);
    expect(root.findings).toEqual([]);
    expect(notice.findings).toEqual([]);
    expect(word.findings.map((finding) => finding.reason)).toEqual([
      'is not a repository relative path',
    ]);
    expect(sentence.findings.map((finding) => finding.reason)).toEqual([
      'is not a repository relative path',
    ]);
    expect(shouting.findings.map((finding) => finding.reason)).toEqual([
      'is not a repository relative path',
    ]);
  });

  it('should hold the extensionless enumeration to the disk in both directions', () => {
    // Given the enumeration, which is the only way a bare word may be a path, and every tracked
    // file with no dot in its final segment. A LIST THAT ADMITS A BARE WORD HAS TO BE PINNED AT
    // BOTH ENDS: one direction is the false negative coming back the moment somebody adds a
    // CODEOWNERS, the other is the list growing words no file in this repository is named.
    const tracked = trackedFiles();
    const extensionless = tracked.filter((file) => !(file.split('/').pop() ?? '').includes('.'));

    // When the names are taken off the disk
    const onDisk = [...new Set(extensionless.map((file) => file.split('/').pop() ?? ''))].sort();

    // Then the subject is present, and the two lists are the same list
    expect(extensionless.length).toBeGreaterThan(0);
    expect(onDisk).toEqual([...EXTENSIONLESS_FILES].sort());
  });

  it('should stay green on every value the review named as ordinary future work', () => {
    // Given the eight the review measured red against bounds taken from one day's artefact, each
    // one a thing this project can be expected to write, planted into a copy of the real file
    const original = artefactCopy();
    const spec = original.data.spec;
    const packages = spec.packages;
    const honest: Readonly<Record<string, AiDocsProjection>> = {
      'a required document at ai-docs/00-overview/PROJECT-STANDARDS.md, 40 against 30': {
        ...original,
        data: {
          ...original.data,
          documents: [
            ...original.data.documents,
            { file: 'ai-docs/00-overview/PROJECT-STANDARDS.md', bytes: 12_345 },
          ],
        },
      },
      'a fourth stylesheet at ai-docs/design/telltale/tokens-dark.css, 39 against 38': {
        ...original,
        data: {
          ...original.data,
          stylesheets: [
            ...original.data.stylesheets,
            {
              file: 'ai-docs/design/telltale/tokens-dark.css',
              css: original.data.stylesheets[0]?.css ?? null,
            },
          ],
        },
      },
      'a reader page route <route>/operations/{operationId}, 32 against 30': {
        ...original,
        data: {
          ...original.data,
          spec: {
            ...spec,
            readerPages: [...(spec.readerPages ?? []), '<route>/operations/{operationId}'],
          },
        },
      },
      'a seven part token --oref-color-scheme-dark-surface-raised-hover, 7 against 6': {
        ...original,
        data: {
          ...original.data,
          stylesheets: original.data.stylesheets.map((sheet, at) => {
            if (at !== 0) return sheet;
            const lines = (sheet.css ?? '').split('\n');
            lines.splice(1, 0, '--oref-color-scheme-dark-surface-raised-hover: 0;');
            return { ...sheet, css: lines.join('\n') };
          }),
        },
      },
      'a SPEC 21 row named Observability, 13 against 11': {
        ...original,
        data: {
          ...original.data,
          spec: { ...spec, suiteRows: { ...spec.suiteRows, Observability: [] } },
        },
      },
      'a milestoneClauses key RELEASE, 7 against 3': {
        ...original,
        data: {
          ...original.data,
          spec: { ...spec, milestoneClauses: { ...spec.milestoneClauses, RELEASE: [] } },
        },
      },
      'a milestoneClauses key POST-1.0, 8 against 3': {
        ...original,
        data: {
          ...original.data,
          spec: { ...spec, milestoneClauses: { ...spec.milestoneClauses, 'POST-1.0': [] } },
        },
      },
      'a 32 character claim id, against 31': {
        ...original,
        data: {
          ...original.data,
          claimMap: (original.data.claimMap ?? []).map((row, at) =>
            at === 0 ? { ...row, id: 'theme-telltale-shadow-dom-parity' } : row,
          ),
        },
      },
      'a published @openref/collector-throttler, 28 against 26': {
        ...original,
        data: {
          ...original.data,
          spec: {
            ...spec,
            packages:
              packages === null
                ? null
                : {
                    ...packages,
                    published: [...packages.published, '@openref/collector-throttler'],
                  },
          },
        },
      },
      // THE THREE THE SECOND REVIEW MEASURED AT EXACTLY THEIR BOUND, which is a bound with no
      // headroom at all and a red gate on the next ordinary week's work.
      'a proof naming a corpus snapshot, 8 segments in one token against 8': {
        ...original,
        data: {
          ...original.data,
          claimMap: (original.data.claimMap ?? []).map((row, at) =>
            at === 0
              ? {
                  ...row,
                  proofs: [
                    ...row.proofs,
                    'packages/core/test/corpus/snapshots/oai-3.2-query-example.yaml.ir.json',
                  ],
                }
              : row,
          ),
        },
      },
      'a reader page route <route>/runtime-facts/collectors/{collectorName}, 48 against 48': {
        ...original,
        data: {
          ...original.data,
          spec: {
            ...spec,
            readerPages: [
              ...(spec.readerPages ?? []),
              '<route>/runtime-facts/collectors/{collectorName}',
            ],
          },
        },
      },
      'an amendment entry id TX-REDUCEDMOTION-CONTRACT, 13 capitals against 12': {
        ...original,
        data: {
          ...original.data,
          markers: original.data.markers.map((marker, at) =>
            at === 0 ? { ...marker, entry: 'TX-REDUCEDMOTION-CONTRACT' } : marker,
          ),
        },
      },
      // AND THE SAME ID AT THE OTHER POSITION IT REACHES, because the defect was not the bound but
      // that two positions holding one kind carried two different numbers.
      'the same id inside the amendment heading that declares it': {
        ...original,
        data: {
          ...original.data,
          amendments: ((): string => {
            const lines = (original.data.amendments ?? '').split('\n');
            const at = lines.findIndex((line) => /^### \[[ x]\] `TX-/u.test(line));
            lines[at] = '### [ ] `TX-REDUCEDMOTION-CONTRACT` #0123456789abcdef';
            return lines.join('\n');
          })(),
        },
      },
      'the same id inside the deferral marker that points at it': {
        ...original,
        data: {
          ...original.data,
          markers: original.data.markers.map((marker, at) =>
            at === 0
              ? {
                  ...marker,
                  text: '(DEFER POST-1.0, `TX-REDUCEDMOTION-CONTRACT`)',
                  kind: 'deferral',
                  owner: 'POST-1.0',
                  entry: 'TX-REDUCEDMOTION-CONTRACT',
                }
              : marker,
          ),
        },
      },
      // A DOTFILE AS A PROOF, found while measuring the path grammar against the 1,410 tracked
      // files: the dependency rules live in one, and a claim about them could not cite it.
      'a proof naming .dependency-cruiser.cjs, which the path grammar used to refuse': {
        ...original,
        data: {
          ...original.data,
          claimMap: (original.data.claimMap ?? []).map((row, at) =>
            at === 0 ? { ...row, proofs: [...row.proofs, '.dependency-cruiser.cjs'] } : row,
          ),
        },
      },
    };

    // When, Then, each named so a failure says which one
    for (const [what, artefact] of Object.entries(honest)) {
      expect([what, scanProjectionProse(artefact).findings]).toEqual([what, []]);
    }
  });
});

/**
 * What the scan does NOT catch, asserted so the next reviewer finds it written down.
 *
 * A WHITELIST OF SHAPES CANNOT SEPARATE PROSE FROM DATA AT THE BOUNDARY. A four word hyphenated
 * leak and a four word hyphenated identifier are the same shape, and every bound sized to what its
 * kind can be leaves room inside it. The cases below plant exactly that and assert it PASSES, which
 * is the honest half of the ruling: the generator is the guarantee, and closing this room would
 * mean refusing the honest work that shares the shape.
 */
describe('the residue the scan admits', () => {
  function artefactCopy(): AiDocsProjection {
    return JSON.parse(readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8')) as AiDocsProjection;
  }

  it('should admit a short phrase spelled like an identifier, at each position that has room', () => {
    // Given the four the review planted short enough to fit, one per kind of position
    const original = artefactCopy();
    const spec = original.data.spec;
    const packages = spec.packages;
    const residue: Readonly<Record<string, AiDocsProjection>> = {
      'a four word route': {
        ...original,
        data: {
          ...original.data,
          spec: { ...spec, readerPages: [...(spec.readerPages ?? []), '<route>/the-runner-ships'] },
        },
      },
      'a three word ecosystem package name': {
        ...original,
        data: {
          ...original.data,
          spec: {
            ...spec,
            packages:
              packages === null
                ? null
                : { ...packages, ecosystem: [...packages.ecosystem, '@openref/runner-ships-now'] },
          },
        },
      },
      'four capitalised words as an amendment entry id': {
        ...original,
        data: {
          ...original.data,
          markers: original.data.markers.map((marker, at) =>
            at === 0 ? { ...marker, entry: 'TX-THE-RUNNER-SHIPS-NOW' } : marker,
          ),
        },
      },
      'two camel cased words as a SPEC 21 row KEY': {
        ...original,
        data: {
          ...original.data,
          spec: { ...spec, suiteRows: { ...spec.suiteRows, RunnerShips: [] } },
        },
      },
      // THE TWO THE SECOND REVIEW ADDED, both of which this group had no case for.
      'a four word sentence on a line of a projected stylesheet, the largest word channel': {
        ...original,
        data: {
          ...original.data,
          stylesheets: original.data.stylesheets.map((sheet, at) => {
            if (at !== 0) return sheet;
            const lines = (sheet.css ?? '').split('\n');
            lines.splice(1, 0, '--the-runner-ships-without-the-proxy: 0;');
            return { ...sheet, css: lines.join('\n') };
          }),
        },
      },
      'a five word path at a position the claims gate does not close': {
        ...original,
        data: {
          ...original.data,
          markers: original.data.markers.map((marker, at) =>
            at === 0 ? { ...marker, file: 'the/runner/ships/without/the-proxy.md' } : marker,
          ),
        },
      },
    };

    // When, Then. This is the one group where an empty finding list is the assertion rather than
    // the pass, so each is named and the count is held: a residue that quietly grew would show as
    // a case that no longer belongs here.
    for (const [what, artefact] of Object.entries(residue)) {
      expect([what, scanProjectionProse(artefact).findings]).toEqual([what, []]);
    }

    expect(Object.keys(residue)).toHaveLength(6);
  });

  it('should name every one of them in the code rather than only here', () => {
    // Given the list the scan publishes for a reader who never opens this file
    // When, Then
    expect(ACKNOWLEDGED_RESIDUE.length).toBeGreaterThan(0);
    expect(ACKNOWLEDGED_RESIDUE.join(' ')).toContain('data.spec.readerPages[]');
    expect(ACKNOWLEDGED_RESIDUE.join(' ')).toContain('data.markers[].entry');
    expect(ACKNOWLEDGED_RESIDUE.join(' ')).toContain('data.claimMap[].proofs[]');
  });

  it('should name a position by name wherever one can hold a character at all', () => {
    // Given every position the rule table has, and the observation that made this case necessary:
    // the list named seven and the reviewer found four more kinds of room in it, among them every
    // numeric position and the stylesheet lines, which are the largest word channel in the file.
    // Residue a reviewer has to discover is the thing naming exists to prevent, so completeness is
    // checked rather than intended.
    const named = ACKNOWLEDGED_RESIDUE.join(' ');
    const exempt = PROJECTION_LEAF_PATHS.filter((path) => PROJECTION_BOUNDS[path]?.chars === 0);
    const carrying = PROJECTION_LEAF_PATHS.filter((path) => PROJECTION_BOUNDS[path]?.chars !== 0);

    // When, Then. The exempt six hold nothing but a digest, which measures zero after the strip,
    // so there is no room in one to name. They are asserted to be a real and small set rather than
    // left as whatever the filter happened to catch.
    expect(exempt).toEqual([
      'data.claimMap[].quoted',
      'data.spec.budgetRows[].label',
      'data.spec.milestoneClauses.*[]',
      'data.spec.securityClaims[].text',
      'data.spec.suiteRows.*[]',
      'integrity',
    ]);
    expect(carrying.length).toBeGreaterThan(20);

    for (const path of carrying) {
      expect([path, named.includes(path)]).toEqual([path, true]);
    }
  });
});

/**
 * What `tools/gates/README.md` tells a reader the artefact carries.
 *
 * IT IS DERIVED RATHER THAN ASSERTED BESIDE THE FILE, which is the ruling this run has already made
 * twice. The README used to list four kinds of value and name only property names and selectors for
 * the stylesheets, while ten declarations in each projected sheet keep a real value. The list is now
 * the same vocabulary the scan classifies leaves into, and this reconciles the two.
 */
describe('the README census', () => {
  it('should name every kind of value the artefact carries, and no kind it does not', () => {
    // Given the kinds the README publishes between its markers
    const readme = readFileSync(join(repoRoot, 'tools/gates/README.md'), 'utf8');
    const section =
      readme.split('<!-- value-kinds -->')[1]?.split('<!-- /value-kinds -->')[0] ?? '';
    const named = [...section.matchAll(/^- `([a-z-]+)`:/gmu)].map((match) => match[1] ?? '').sort();

    // When the artefact itself is asked
    const read = readProjection(repoRoot);
    const scan = scanProjectionProse(read.ok ? read.projection : {});

    // Then, and the subject is asserted present before it is compared
    expect(named.length).toBeGreaterThan(0);
    expect(named).toEqual([...scan.kinds]);
  });
});

/**
 * Every figure this corner of the repository states about the repository, counted.
 *
 * THREE OF THEM WERE HAND WRITTEN AND ALL THREE WERE WRONG, which is why they are here rather than
 * in a comment. `index.ts` said four gates skip without the private documents, `lib/ai-docs.ts` said
 * one call site of four, and `lib/projection.ts` put a collision at one in ten to the eleventh
 * against "a few thousand" digests. A count of things in the repository is a thing a test can take,
 * and a claim nobody can re-derive is the class this slice is about.
 */
describe('the figures this code states about this repository', () => {
  it('should read every figure the bounds cite off the artefact rather than off a memory', () => {
    // Given the table of figures the comments in lib/projection-prose.ts state, and the artefact
    // they are supposed to describe. THE FOURTH ROUND FOUND THREE MORE WRONG: a CONTENTS line is
    // 24 characters and the comment said 26, the longest amendment line is 31 and the comment
    // named a different line at 24, and a claim id has two segments of room rather than one.
    const read = readProjection(repoRoot);
    expect(read.ok).toBe(true);

    // When the same walk that enforces the bounds is asked what the artefact reads
    const scan = scanProjectionProse(read.ok ? read.projection : {}, read.ok ? read.bytes : 0);

    // Then every cited figure is the reading, named so a failure says which sentence to fix
    expect(CITED_READINGS.length).toBeGreaterThan(10);

    for (const cited of CITED_READINGS) {
      expect([
        cited.cited,
        cited.path,
        cited.measure,
        scan.reach[cited.path]?.[cited.measure],
      ]).toEqual([cited.cited, cited.path, cited.measure, cited.reading]);
    }
  });

  it('should derive the file budget from the artefact rather than from a round number', () => {
    // Given the arithmetic PROJECTION_ARTEFACT_BUDGET states: the artefact weighs 131,133 bytes
    // over 644 leaves, an amendment heading costs 421 bytes, a plan task 126 and a claim map row
    // 224, so a milestone of eight tasks, five owned entries and seven rows is 8,049 bytes and the
    // headroom is two of them. EACH TASK COSTS A PLAN ENTRY AND A HEADING BOTH, which is why the
    // eight is multiplied by the sum of two costs and not by one of them, and which the comment
    // beside the budget used to leave for a reader to work out from a total that did not add up.
    // The reading was 128,322 until 2026-09-04, then 128,714, then 128,762, then 128,977 over 626
    // leaves as `T065` wrote its answers into the sections and SPEC 4 gained its held back section,
    // which was the first new leaf any of those moves cost, because a package name is a leaf where
    // a paragraph is not. The close of `T065` took it to 131,133 over 644: eight POST-1.0 entries
    // with their headings and their `**Milestone:**` lines, and three markers, the other five
    // markers going into the source files their subjects live in, where the sweep reads them live
    // and the artefact carries nothing. THE MOVE WAS BOUNDED BY THIS CASE RATHER THAN NOTICED
    // AFTER IT: the first draft of those entries went 992 bytes past two milestones of headroom and
    // was cut and re-homed until it fitted, and no ceiling moved for it. The ceiling has not moved
    // and is not the subject of this case; what moves is the reading, and the two bounds below are
    // what say the corridor still holds.
    const read = readProjection(repoRoot);
    expect(read.ok).toBe(true);
    const data = read.ok ? read.projection.data : undefined;
    const amendments = data?.amendments ?? '';
    const headings = amendments.split('\n').filter((line) => /^#{2,3} /u.test(line)).length;
    const perHeading = Math.round(JSON.stringify(amendments).length / headings);
    const perTask = Math.round(JSON.stringify(data?.build ?? '').length / BUILD_TASK_COUNT);
    const rows = data?.claimMap ?? [];
    const perRow = Math.round(JSON.stringify(rows).length / rows.length);
    const milestone = 8 * (perTask + perHeading) + 5 * perHeading + 7 * perRow;

    // When
    const scan = scanProjectionProse(read.ok ? read.projection : {}, read.ok ? read.bytes : 0);

    // Then each figure the budget's derivation states is the one the artefact gives, and the
    // headroom really is two milestones of it
    expect([scan.bytes, scan.leaves]).toEqual([131_133, 644]);
    expect([perHeading, perTask, perRow]).toEqual([421, 126, 224]);
    expect(milestone).toBe(8_049);
    expect(PROJECTION_ARTEFACT_BUDGET.limitBytes - scan.bytes).toBeGreaterThanOrEqual(
      2 * milestone,
    );
    expect(PROJECTION_ARTEFACT_BUDGET.limitBytes - scan.bytes).toBeLessThan(3 * milestone);
  });

  /** Every file under `tools/gates/src`, read once. */
  function sources(): { readonly file: string; readonly text: string }[] {
    const found: { file: string; text: string }[] = [];

    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (entry.name.endsWith('.ts')) {
          found.push({ file: relative(repoRoot, path), text: readFileSync(path, 'utf8') });
        }
      }
    };

    walk(join(repoRoot, 'tools/gates/src'));

    return found;
  }

  it('should let no gate skip for absent documents that the reason does not name, either way', () => {
    // Given the declared readers of the cause, and the gates whose own source can name it
    const permitted =
      SKIP_REASONS.find((reason) => reason.id === 'ai-docs-absent')?.permitted ?? [];
    const files = sources();

    // When each gate is asked what its own source says
    const declaring = GATES.map((gate) => gate.id).filter((id) =>
      files.some(
        (source) =>
          source.file.startsWith('tools/gates/src/gates/') &&
          source.text.includes(`id: '${id}'`) &&
          source.text.includes("skipReason: 'ai-docs-absent'"),
      ),
    );

    // Then, and the subject is asserted present before it is compared: an empty list on both sides
    // would reconcile perfectly and mean nothing
    expect(declaring.length).toBeGreaterThan(0);
    expect([...permitted].sort()).toEqual([...declaring].sort());
  });

  it('should print how many gates may skip rather than stating it in a comment', () => {
    // Given the entry point, which said "Four gates skip there" while two did
    const text = readFileSync(join(repoRoot, 'tools/gates/src/index.ts'), 'utf8');

    // When
    const written = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) gates? skip/iu.exec(
      text,
    );

    // Then the number comes off `SKIP_REASONS` at run time and is nowhere written by hand
    expect(text).toContain('maySkip.length');
    expect(written?.[0]).toBeUndefined();
  });

  it('should count the gates that fail once the artefact is deleted, which is the thirteen', () => {
    // Given the third of the three numbers, which is the only one that is a count of things in the
    // repository: how many gates report an error with no artefact to read. Four of them reach it
    // through `readSpecHalf`, so a grep for `readProjection` alone answers twelve.
    const files = sources().filter((source) => source.file.startsWith('tools/gates/src/gates/'));
    const readers = GATES.map((gate) => gate.id).filter((id) =>
      files.some(
        (source) =>
          source.text.includes(`id: '${id}'`) &&
          (source.text.includes('readProjection(') || source.text.includes('readSpecHalf(')),
      ),
    );

    // When, Then, and the subject is asserted present before it is compared
    expect(readers.length).toBeGreaterThan(0);
    expect([...readers].sort()).toEqual([...GATES_THAT_READ_THE_PROJECTION].sort());
    expect(GATES_THAT_READ_THE_PROJECTION).toHaveLength(13);
  });

  it('should keep the three numbers three numbers, and none of them the skip count twice', () => {
    // Given the confusion this replaces: `skip-accounting.ts` opened by stating fourteen as if it
    // were the skip count, and contradicted its own permitted list twenty lines below
    // When
    const skipped = GATES_THAT_SKIPPED.length;
    const readers = GATES_THAT_READ_THE_PROJECTION.length;

    // Then twelve skipped, the permitted list was two longer than that, and the readers are the
    // twelve plus the one gate the artefact itself needed
    expect(skipped).toBe(12);
    expect(GATES_PERMITTED_TO_SKIP_THEN).toBe(skipped + 2);
    expect(readers).toBe(skipped + 1);
    expect([...GATES_THAT_READ_THE_PROJECTION].sort()).toEqual(
      [...GATES_THAT_SKIPPED, 'projection-privacy'].sort(),
    );
  });

  it('should let none of the three numbers be a bare figure in a sentence again', () => {
    // Given the file where the three were conflated, which is the one that has to say which is
    // which. Each of the three appears there as a word beside what it counts, and the two that are
    // lists are exported so a test can hold them.
    const text = readFileSync(join(repoRoot, 'tools/gates/src/lib/skip-accounting.ts'), 'utf8');

    // When, Then
    expect(text).toContain('THREE NUMBERS DESCRIBE THIS CHANGE');
    expect(text).toContain('TWELVE gates reported `skip`');
    expect(text).toContain('FOURTEEN was the LENGTH OF THE PERMITTED LIST');
    expect(text).toContain('THIRTEEN IS NOT A GATE COUNT IN THIS FILE AT ALL');
    // and the sentence that conflated them survives only as a quotation with its correction
    // beside it, because deleting the wrong claim would leave nobody able to see it was made
    expect(text).toContain('with fourteen standing in\n * for the skip count');
  });

  it('should count the call sites of the absent-documents message rather than remember them', () => {
    // Given every source of the gates, minus the file that defines the message
    const calls = sources()
      .filter((source) => !source.file.endsWith('lib/ai-docs.ts'))
      .reduce(
        (total, source) => total + (source.text.match(/aiDocsAbsentMessage\(/gu) ?? []).length,
        0,
      );

    // When, Then
    expect(calls).toBe(AI_DOCS_ABSENT_CALL_SITES);
  });

  it('should state a collision figure the digest count reproduces', () => {
    // Given the artefact and the file that states the odds
    const artefact = readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8');
    const text = readFileSync(join(repoRoot, 'tools/gates/src/lib/projection.ts'), 'utf8');

    // When the count is taken and the birthday bound computed from it
    const digests = distinctDigestsIn(artefact);
    const odds = 2 ** 64 / ((digests * (digests - 1)) / 2);
    const stated = `one in ${(odds / 1e12).toFixed(1)}e12`;

    // Then the recorded count is the artefact's, and the figure in the comment is that arithmetic
    expect(digests).toBe(PROJECTION_DISTINCT_DIGESTS);
    expect(stated).toBe('one in 6.2e12');
    expect(text).toContain(stated);
  });
});

/**
 * The scan as a gate, so `pnpm gates` answers the question CI already answered.
 *
 * IT WAS A UNIT CASE AND NOTHING ELSE. CI runs the suite and the gates both, so CI was covered; the
 * command CLAUDE.md tells every session to run before declaring a slice done is `pnpm gates`, and
 * that command proved nothing about the privacy of the file the whole projection exists to make
 * safe. The gate calls the same function rather than restating the rule.
 */
describe('the projection privacy gate', () => {
  it('should pass on the committed artefact, having read a real number of leaves', async () => {
    // Given the repository as it ships
    // When
    const result = await projectionPrivacyGate.run({ repoRoot });
    const read = result.findings.find((finding) => finding.level === 'info')?.message ?? '';

    // Then, and the count is in the output so a pass over nothing could not read as a pass
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
    expect(read).toMatch(/^\d+ leaf\/leaves read across \d+ position\(s\)/u);
  });

  it('should fail on a planted sentence, naming the position it sits at', async () => {
    // Given a copy of the real artefact with a sentence written as a claim id, signed so that it
    // fails for what it carries rather than for its integrity
    const root = mkdtempSync(join(tmpdir(), 'openref-projection-privacy-'));
    planted = root;
    const original = JSON.parse(
      readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8'),
    ) as AiDocsProjection;
    const sentence = 'the-maintainer-ruled-the-runner-ships-without-the-proxy-in-m8';
    const data = {
      ...original.data,
      claimMap: (original.data.claimMap ?? []).map((row, at) =>
        at === 0 ? { ...row, id: sentence } : row,
      ),
    };
    writeProjection(root, { ...original, data, integrity: integrityOf(data) });

    // When
    const result = await projectionPrivacyGate.run({ repoRoot: root });
    const messages = result.findings.map((finding) => finding.message).join(' ');

    // Then
    expect(result.status).toBe('fail');
    expect(messages).toContain('leaf-refused');
    expect(messages).toContain('data.claimMap[].id');
  });

  it('should refuse an artefact too small to have checked anything', async () => {
    // Given a well formed, correctly signed artefact carrying almost nothing. Every leaf in it is
    // admitted, so the scan finds nothing, which is exactly what a scan over a real file finds.
    const root = mkdtempSync(join(tmpdir(), 'openref-projection-empty-'));
    planted = root;
    const data = {
      documents: [],
      build: null,
      amendments: null,
      markers: [],
      spec: {
        packages: null,
        securityClaims: null,
        budgetRows: null,
        suiteRows: {},
        milestoneClauses: {},
        readerPages: null,
      },
      claimMap: null,
      stylesheets: [],
    };
    writeProjection(root, { version: PROJECTION_VERSION, data, integrity: integrityOf(data) });

    // When
    const result = await projectionPrivacyGate.run({ repoRoot: root });
    const messages = result.findings.map((finding) => finding.message).join(' ');

    // Then the emptiness is the finding, and the floor is named
    expect(result.status).toBe('fail');
    expect(messages).toContain('scan-too-small');
    expect(messages).toContain(String(PROJECTION_LEAF_FLOOR));

    // And the corridor is said where the reader meets it, which is here: the floor is one end and
    // the budget is the other, the reading sits between them, and neither is the other's margin.
    // A NARROW CORRIDOR IS NOT A REASON TO MOVE EITHER NUMBER, and this is where somebody about to
    // move one is standing.
    expect(messages).toContain(String(PROJECTION_ARTEFACT_BUDGET.leaves));
    expect(messages).toContain('whether there is an artefact here at all');
    expect(messages).toContain('whether there is too much of one');
    expect(messages).toContain("Neither is the other's margin");
  });

  it('should print both ends of the corridor on a run that passes', async () => {
    // Given the committed artefact, where the corridor is a fact rather than a failure. A READER
    // WHO ONLY MEETS THE FLOOR IN ONE RED GATE AND THE BUDGET IN ANOTHER never sees that the
    // reading sits between two answers to two different questions.
    // When
    const result = await projectionPrivacyGate.run({ repoRoot });
    const messages = result.findings.map((finding) => finding.message).join(' ');

    // Then the run is green and prints the floor, the reading and the budget together
    expect(result.status).toBe('pass');
    expect(messages).toContain(`leaves between a floor of ${String(PROJECTION_LEAF_FLOOR)}`);
    expect(messages).toContain(`a budget of ${String(PROJECTION_ARTEFACT_BUDGET.leaves)}`);
    expect(messages).toContain('the file is an absence rather than a reading');
  });

  it('should keep the reading inside the corridor, both ends asserted', () => {
    // Given the artefact as it ships, and the two numbers it has to sit between
    const read = readProjection(repoRoot);
    expect(read.ok).toBe(true);

    // When
    const scan = scanProjectionProse(read.ok ? read.projection : {}, read.ok ? read.bytes : 0);

    // Then it is above the floor, so it is a reading and not an absence, and under the budget, so
    // it is a reading and not a volume. The corridor is narrow and that is what it is: 144 leaves
    // of room under the reading and 156 over it. Both ends are asserted precisely so that a leaf
    // arriving is a decision somebody takes rather than a drift; it read 125 and 175 until
    // 2026-09-04, when SPEC 4's held back section put `@openref/nuxt` into the artefact, then 126
    // and 174, and it reads 144 and 156 since the T065 close, which put eight POST-1.0 entries into
    // the amendments and three of their markers into documents the artefact projects, the other
    // five going to the source files their subjects live in, where the sweep reads them live and
    // the artefact does not carry them at all. NEITHER END OF THE CORRIDOR MOVED ON ANY OF THE
    // THREE OCCASIONS: the floor is still PROJECTION_LEAF_FLOOR and the budget is still
    // PROJECTION_ARTEFACT_BUDGET.leaves, and what these two numbers record is where the reading now
    // stands between them.
    expect(scan.leaves).toBeGreaterThan(PROJECTION_LEAF_FLOOR);
    expect(scan.leaves).toBeLessThan(PROJECTION_ARTEFACT_BUDGET.leaves);
    expect(scan.leaves - PROJECTION_LEAF_FLOOR).toBe(144);
    expect(PROJECTION_ARTEFACT_BUDGET.leaves - scan.leaves).toBe(156);
  });

  it('should be in the gate list, since a gate nothing runs is a rule with no runner', () => {
    // Given
    // When
    const ids = GATES.map((gate) => gate.id);

    // Then
    expect(ids).toContain(projectionPrivacyGate.id);
  });
});

describe('staleness', () => {
  it('should name the section a changed document moved', () => {
    // Given a tree, and the same tree with one box ticked in the plan
    const root = plant({ [BUILD_FILE]: `${PLAN}\n` });
    const before = projectFromDisk(root, projectionRequest());
    writeFileSync(join(root, BUILD_FILE), `${PLAN.replace('[x]', '[ ]')}\n`);
    const after = projectFromDisk(root, projectionRequest());

    // When
    const stale = staleSections(before.data, after.data);

    // Then
    expect(stale).toEqual(['build']);
  });

  it('should be silent on a document that did not move', () => {
    // Given
    const root = plant({ [BUILD_FILE]: `${PLAN}\n` });

    // When
    const stale = staleSections(
      projectFromDisk(root, projectionRequest()).data,
      projectFromDisk(root, projectionRequest()).data,
    );

    // Then
    expect(stale).toEqual([]);
  });

  it.skipIf(!HAVE_AI_DOCS)(
    'should take the build manifest gate red when a document moves and nothing regenerates',
    async () => {
      // Given a root that is the real one for the documents and a copy for the artefact. The
      // committed file is never written: an earlier version of this case forged an integrity into
      // it and restored it in a `finally`, which raced every other suite reading the same path in
      // a parallel worker. `ai-docs/` is linked rather than copied, so the gate regenerates the
      // projection from the real documents; the artefact beside it is one line out of date, which
      // is the same disagreement as an edited document seen from the other side.
      const root = mkdtempSync(join(tmpdir(), 'openref-projection-stale-'));
      planted = root;
      symlinkSync(join(repoRoot, AI_DOCS_DIR), join(root, AI_DOCS_DIR), 'dir');

      const committed = readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8');
      const parsed = JSON.parse(committed) as AiDocsProjection;
      const build = parsed.data.build ?? '';
      const stale = {
        ...parsed,
        data: { ...parsed.data, build: `${build}\n` },
      };
      writeProjection(root, { ...stale, integrity: integrityOf(stale.data) });

      // When
      const result = await buildManifestGate.run({ repoRoot: root });

      // Then the staleness is named, the command that fixes it is named, and the gate is red
      expect(result.status).toBe('fail');
      expect(result.findings.map((finding) => finding.message).join(' ')).toContain(
        'projection-stale',
      );
      expect(result.findings.map((finding) => finding.message).join(' ')).toContain(
        'pnpm gates:projection',
      );

      // And the committed artefact was not touched to get here
      expect(readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8')).toBe(committed);
    },
  );

  it('should leave a stale artefact green on a checkout with no documents, and say so', async () => {
    // Given a stale artefact on a tree with no ai-docs/: one document's size changed, which no
    // check inside the artefact reads, so the only thing wrong with it is that it no longer says
    // what the documents say. THAT COMPARISON CANNOT BE MADE WITHOUT THE DOCUMENTS, so "a stale
    // artefact is a red build" is true where ai-docs/ is present and nowhere else, and this is the
    // case that holds the weaker half honest.
    const root = mkdtempSync(join(tmpdir(), 'openref-projection-clone-'));
    planted = root;
    const original = JSON.parse(
      readFileSync(join(repoRoot, PROJECTION_FILE), 'utf8'),
    ) as AiDocsProjection;
    const data = {
      ...original.data,
      documents: original.data.documents.map((doc, at) =>
        at === 0 ? { ...doc, bytes: (doc.bytes ?? 0) + 1 } : doc,
      ),
    };
    writeProjection(root, { ...original, data, integrity: integrityOf(data) });
    expect(aiDocsPresent(root)).toBe(false);

    // When
    const result = await buildManifestGate.run({ repoRoot: root });

    // Then the run is green, the question that went unasked is named, and it is a warning rather
    // than an error
    expect(result.status).toBe('pass');
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(
      result.findings
        .filter((finding) => finding.level === 'warning')
        .map((finding) => finding.message)
        .join(' '),
    ).toContain('this run proves nothing about whether it is current');
  });

  it.skipIf(!HAVE_AI_DOCS)('should be current in the committed tree', async () => {
    // Given the real repository. This is the case that fails the day a document moves and the
    // artefact does not follow it.
    const result = await buildManifestGate.run({ repoRoot });

    // When, Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
  });
});

describe('the surrogate plan against the real one', () => {
  it.skipIf(!HAVE_AI_DOCS)('should answer the line addressing exactly as the document does', () => {
    // Given the real plan and the surrogate the artefact carries
    const document = readFileSync(join(repoRoot, BUILD_FILE), 'utf8');
    const read = readProjection(repoRoot);

    // When
    const fromDocument = checkBuildManifest(document, BUILD_LINE_COUNT, BUILD_TASK_COUNT);
    const fromArtefact = checkBuildManifest(
      read.ok ? (read.projection.data.build ?? '') : '',
      BUILD_LINE_COUNT,
      BUILD_TASK_COUNT,
    );

    // Then
    expect(fromDocument).toEqual([]);
    expect(fromArtefact).toEqual(fromDocument);
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILD_AMENDMENTS_FILE,
  BUILD_FILE,
  M7_DECLINED_SECTION,
  M7_DECLINED_TASK,
  M7_MILESTONE,
  M7_MILESTONE_CLAUSES,
  M7_SUITE_COVERAGE,
  M7_SUITE_ROWS,
  M7_TASKS,
  SPEC_FILE,
} from '../../src/config';
import { runM7SuitesGate } from '../../src/gates/m7-suites.gate';
import { aiDocsPresent } from '../../src/lib/ai-docs';
import {
  assertionlessCaseTitlesIn,
  caseTitlesIn,
  checkMilestoneClauses,
  checkStaticCoverage,
  milestoneClausesOf,
  suiteRowOf,
} from '../../src/lib/static-suites';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The committed M7 wiring, held to the three documents it answers.
 *
 * WHAT IS NEW IN THIS GATE IS THE THIRD DOCUMENT. `checkStaticCoverage` and `checkMilestoneClauses`
 * are the Static row's and have their planted failures in `static-suites.spec.ts`; what no earlier
 * member of this family did is read `ai-docs/BUILD.md` and `ai-docs/BUILD-AMENDMENTS.md` to state
 * which tasks the milestone closes over. That reading is the one this file plants failures for,
 * because it is the one that can go quietly wrong: M7 carries a task whose box can never tick, and
 * a gate excluding it on its own authority would be the silent weakening the exclusion exists
 * against.
 *
 * THE GATE FUNCTION IS EXERCISED ON A PLANTED TREE AND NEVER ON THIS ONE, deliberately: on a clean
 * wiring it runs a real `nuxt generate`, which is a gate's work rather than a unit test's.
 */

let planted: string | undefined;

afterEach(() => {
  if (planted !== undefined) rmSync(planted, { recursive: true, force: true });
  planted = undefined;
});

/**
 * A repository root holding the named files and nothing else.
 *
 * @param files - Repository relative paths to write, with their content
 * @returns Absolute path of the planted root
 */
function plant(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'openref-m7-suites-'));
  planted = root;

  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  return root;
}

/** The three real documents plus every wired suite, so a planted failure is the only failure. */
function cleanTree(): Record<string, string> {
  const files: Record<string, string> = {
    [SPEC_FILE]: readFileSync(join(repoRoot, SPEC_FILE), 'utf8'),
    [BUILD_FILE]: readFileSync(join(repoRoot, BUILD_FILE), 'utf8'),
    [BUILD_AMENDMENTS_FILE]: readFileSync(join(repoRoot, BUILD_AMENDMENTS_FILE), 'utf8'),
  };

  for (const coverage of [...M7_SUITE_COVERAGE, ...M7_MILESTONE_CLAUSES]) {
    for (const file of coverage.files) {
      // ACCUMULATED RATHER THAN ASSIGNED, because several coverages name the same file.
      files[file] =
        (files[file] ?? '') +
        coverage.cases
          .map((name) => `it(${JSON.stringify(name)}, () => {\n  expect(1).toBe(1);\n});\n`)
          .join('\n');
    }
  }

  return files;
}

/** Every error message the gate produced on a planted root. */
function errorsOf(root: string): string[] {
  return runM7SuitesGate({ repoRoot: root })
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => finding.message);
}

/**
 * One substitution, refusing to plant a fault whose subject it could not find.
 *
 * `String.replace` answers the document unchanged when the literal it was handed is not in it, so a
 * plant written against a line that can legitimately change quietly stops planting anything, and
 * the case then reports the gate as broken. That is what happened here the day `T062` was ticked:
 * the plant below anchored on the literal text of an unticked `T062` CONTENTS line, the tick made
 * that text absent, the planted tree became the real one, and the case went red with nothing wrong
 * in the gate at all. A proof that a gate refuses something must first prove the something was
 * there.
 *
 * @param text - Document to plant the fault in
 * @param pattern - Subject the plant rewrites, which must be present
 * @param replacement - What that subject becomes
 * @returns The planted document
 */
function plantInto(text: string, pattern: RegExp | string, replacement: string): string {
  const result = text.replace(pattern, replacement);
  expect(result, 'the plant matched nothing, so this case injected no fault').not.toBe(text);

  return result;
}

/**
 * The real BUILD.md with the boxes of the two M7 tasks set, in CONTENTS and on their headings.
 *
 * THE TICK STATE IS AN INPUT TO THESE CASES RATHER THAN A CONSTANT OF THEM. What the scope reading
 * states is which tasks `M7` closes over, which is a fact about the milestone's membership and not
 * about how much of it is finished: it has to read the same the day before the last box is ticked
 * and the day after. Both states are planted, so closing the milestone cannot turn this file red
 * the way ticking `T062` once did.
 *
 * @param build - Content of `ai-docs/BUILD.md`
 * @param box - The box each M7 task other than the declined one carries
 * @returns The document with those boxes set
 */
function withM7TaskBoxes(build: string, box: ' ' | 'x'): string {
  const result = M7_TASKS.reduce(
    (text, task) =>
      text
        .replace(new RegExp(`^- \\[[ x]\\] \`${task}\``, 'm'), `- [${box}] \`${task}\``)
        .replace(new RegExp(`^### ${task} \\[[ x]\\]`, 'm'), `### ${task} [${box}]`),
    build,
  );

  // ASSERTED BY ITS RESULT RATHER THAN BY A CHANGE, because setting a box to the one it already
  // carries is a legitimate no-op, and both lines still have to end up saying it.
  for (const task of M7_TASKS) {
    expect(result).toContain(`- [${box}] \`${task}\``);
    expect(result).toContain(`### ${task} [${box}]`);
  }

  return result;
}

/**
 * The same document with a task added to M7, planted at whichever box `T062` carries.
 *
 * @param build - Content of `ai-docs/BUILD.md`
 * @returns The document with one more task under the milestone
 */
function withTaskAddedToM7(build: string): string {
  return plantInto(
    build,
    /^- \[[ x]\] `T062`/m,
    '- [ ] `T066`  L1642-L1650  A task nobody planned\n$&',
  );
}

describe('the committed M7 wiring', () => {
  it('should name a suite file that is there for every coverage of the row', () => {
    // Given the wiring this repository ships
    // When
    const missing = M7_SUITE_COVERAGE.flatMap((coverage) =>
      coverage.files.filter((file) => !existsSync(join(repoRoot, file))),
    );

    // Then one row wires eleven coverages, and one of them is another package's suite, which is
    // the count SPEC 21's own paragraph states so a reader checks it against the directory
    expect(M7_SUITE_ROWS).toEqual(['Nuxt']);
    expect(M7_SUITE_COVERAGE).toHaveLength(11);
    expect(
      M7_SUITE_COVERAGE.flatMap((coverage) => coverage.files).filter((file) =>
        file.startsWith('packages/static/'),
      ),
    ).toHaveLength(1);
    expect(missing).toEqual([]);
  });

  it('should name a suite file that is there for every clause of the milestone', () => {
    // Given
    const missing = M7_MILESTONE_CLAUSES.flatMap((clause) =>
      clause.files.filter((file) => !existsSync(join(repoRoot, file))),
    );

    // When, Then
    expect(M7_MILESTONE_CLAUSES).toHaveLength(4);
    expect(missing).toEqual([]);
  });

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer every coverage the SPEC 21 Nuxt row states and invent none',
    () => {
      // Given the real documents and the real repository
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');
      const stated = M7_SUITE_ROWS.flatMap((row) => suiteRowOf(spec, row) ?? []);

      // When
      const issues = checkStaticCoverage(M7_SUITE_COVERAGE, {
        specNames: stated,
        row: M7_SUITE_ROWS.join(', '),
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then
      expect(M7_SUITE_ROWS.filter((row) => suiteRowOf(spec, row) === null)).toEqual([]);
      expect(stated).toHaveLength(11);
      expect(issues).toEqual([]);
    },
  );

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer every clause the M7 definition of done states and invent none',
    () => {
      // Given the real documents, and the clause SPEC 22 lacked until this task wrote it
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

      // When
      const issues = checkMilestoneClauses(M7_MILESTONE_CLAUSES, {
        milestone: M7_MILESTONE,
        clauses: milestoneClausesOf(spec, M7_MILESTONE),
        specNames: [],
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then M7 has one at all, which is the half it did not have before this task
      expect(milestoneClausesOf(spec, M7_MILESTONE)).toHaveLength(4);
      expect(issues).toEqual([]);
    },
  );
});

describe('the milestone scope this gate states in its output', () => {
  it.skipIf(!aiDocsPresent(repoRoot)).each([' ', 'x'] as const)(
    'should name the two tasks M7 closes over and the section that excludes the third, with its tasks [%s]',
    (box) => {
      // Given the real documents, with the M7 boxes set both ways: what the reading states is the
      // milestone's membership, and finishing its tasks is not what makes the statement true
      // When
      const result = runM7SuitesGate({ repoRoot: cleanRoot(box) });
      const scope = result.findings.find((finding) =>
        finding.message.startsWith(`${M7_MILESTONE} closes over`),
      );

      // Then the reading is in the output rather than in a comment, and it carries its reason
      expect(M7_TASKS).toEqual(['T061', 'T062']);
      expect(scope?.message).toContain(M7_TASKS.join(' and '));
      expect(scope?.message).toContain(M7_DECLINED_TASK);
      expect(scope?.message).toContain(M7_DECLINED_SECTION);
    },
  );

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should refuse to exclude the declined task once the section that justifies it is closed',
    () => {
      // Given the same tree with the L3 section ticked, which is the same act as reversing the
      // SPEC 10.2 decision. Every other input is the real one, so nothing else can be the reason.
      const files = cleanTree();
      files[BUILD_AMENDMENTS_FILE] = plantInto(
        files[BUILD_AMENDMENTS_FILE] ?? '',
        `### [ ] \`${M7_DECLINED_TASK}\` ${M7_DECLINED_SECTION}`,
        `### [x] \`${M7_DECLINED_TASK}\` ${M7_DECLINED_SECTION}`,
      );

      // When
      const errors = errorsOf(plant(files));

      // Then. THIS CASE CAME OUT GREEN THE FIRST TIME IT WAS RUN, which is why it is here: `T060`
      // has more than one open section, so a check for any of them passed while the one this
      // exclusion rests on was closed.
      expect(errors.some((message) => message.includes('no open section addressed to'))).toBe(true);
    },
  );

  it.skipIf(!aiDocsPresent(repoRoot)).each([' ', 'x'] as const)(
    'should refuse a milestone whose tasks are not the ones this wiring was written for, with its tasks [%s]',
    (box) => {
      // Given a BUILD.md with a task added to M7, every other input real, and the milestone's own
      // boxes set both ways: the refusal is about membership, so it must not depend on either
      const files = cleanTree();
      files[BUILD_FILE] = withTaskAddedToM7(withM7TaskBoxes(files[BUILD_FILE] ?? '', box));

      // When
      const errors = errorsOf(plant(files));

      // Then
      expect(errors.some((message) => message.includes('this gate is written for'))).toBe(true);
    },
  );

  it('should say it could not read the scope rather than passing where the documents are absent', () => {
    // Given a tree with the suites but no `ai-docs/`, which is every clone.
    //
    // THE FILES ARE FABRICATED HERE AND NOTHING IS READ, which is the shape `m6-suites.spec.ts`
    // uses and which this case did not. Its first form filtered the real documents out of
    // `cleanTree()`, and `cleanTree()` reads all three of them unconditionally: on a clone that
    // throws `ENOENT` and takes the whole `coverage` gate down with it, so the one case whose
    // subject is clone behaviour was the case that could not run on a clone. Measured by the
    // second blind review, and it is the standing rule of `BUILD-AMENDMENTS` L1292 met exactly.
    const files: Record<string, string> = { 'package.json': '{}\n' };
    for (const coverage of [...M7_SUITE_COVERAGE, ...M7_MILESTONE_CLAUSES]) {
      for (const file of coverage.files) {
        // ACCUMULATED RATHER THAN ASSIGNED, because several coverages name the same file and the
        // last write would otherwise drop every case the earlier ones asked for.
        files[file] =
          (files[file] ?? '') +
          coverage.cases
            .map((name) => `it(${JSON.stringify(name)}, () => {\n  expect(1).toBe(1);\n});\n`)
            .join('\n');
      }
    }
    const root = plant(files);

    // When
    const result = runM7SuitesGate({ repoRoot: root });

    // Then no wiring issue is invented, and the unread half says so in words
    expect(aiDocsPresent(root)).toBe(false);
    expect(
      result.findings.filter(
        (finding) => finding.level === 'error' && /^\[[a-z-]+\]/.test(finding.message),
      ),
    ).toEqual([]);
    expect(result.findings.map((finding) => finding.message).join(' ')).toContain(
      'SKIPPED, NOT PASSED',
    );
    expect(result.findings.map((finding) => finding.message).join(' ')).toContain('was not read');
  });
});

/**
 * A planted root carrying the real documents and the real suites, at the given M7 tick state.
 *
 * THE SUITES ARE THE REAL FILES RATHER THAN FABRICATED ONES HERE, so the scope reading is taken on
 * a tree the gate would otherwise pass, and the only thing a case changes is the one thing it is
 * about. `x` is the state this repository is in, so one of the two runs is the real tree unaltered
 * and the other is the same tree before its last box was ticked.
 *
 * @param box - The box each M7 task other than the declined one carries
 * @returns Absolute path of the planted root
 */
function cleanRoot(box: ' ' | 'x'): string {
  const files = cleanTree();
  files[BUILD_FILE] = withM7TaskBoxes(files[BUILD_FILE] ?? '', box);

  return plant(files);
}

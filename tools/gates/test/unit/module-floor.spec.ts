import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { subset, validRange } from 'semver';
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
 *
 * IT READ ONE FILE UNTIL T064 AND THE FILE IT DID NOT READ WAS THE ONE THAT PUBLISHES. The
 * comparison above was made against `ci.yml` alone, so `release-license-audit.yml` was free to pin
 * `node-version: 20`, and it did. SPEC 23 says the package loads on no Node 20 at all, so the job
 * meant to gate publication could not have installed, let alone audited. The scope was the defect
 * rather than the pin: a check that names its one input can never see the input nobody named. Every
 * workflow in the directory is read now, and the set of files is asserted before anything is
 * compared, because a read that found no file reports exactly what a clean one does.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const WORKFLOW_DIRECTORY = resolve(repoRoot, '.github', 'workflows');

/** The full `engines.node` range, which is what a pin has to be compatible with. */
function declaredRange(): string {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    readonly engines?: { readonly node?: string };
  };

  return manifest.engines?.node ?? '';
}

/** The floor as `engines.node` states it. */
function declaredFloor(): string {
  return /(\d+\.\d+\.\d+)/.exec(declaredRange())?.[1] ?? '';
}

/** Every workflow file in the directory, by name. */
function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIRECTORY)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();
}

/** One `node-version:` pin, with the file it was read from. */
interface Pin {
  readonly workflow: string;
  /** The version or range as written, with its quotes stripped. */
  readonly version: string;
  /** Whether it was written at the step or reached through a matrix key. */
  readonly through: string;
}

/**
 * A literal `node-version:` that is not a `${{ }}` expression, quoted or bare.
 *
 * ANCHORED TO THE START OF A LINE SO A COMMENT ABOUT PINS IS NOT READ AS ONE. The unanchored form
 * matched the prose in `release-license-audit.yml`, which quotes the key in backticks while
 * explaining why the key matters, and reported a pin of `` ` ``.
 */
const LITERAL_PIN = /^[ \t]*node-version:[ \t]*(?!\$\{\{)(?:'([^']+)'|"([^"]+)"|([^\s#'"]+))/gm;

/** A `node-version:` that reads a matrix key, which is where the real pins then live. */
const MATRIX_PIN = /^[ \t]*node-version:[ \t]*\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/gm;

/**
 * The literals a matrix key is given, in either of the two forms YAML writes a list in.
 *
 * @param text - The whole workflow file
 * @param key - The matrix key a step reads
 * @returns One entry per literal, empty when the key holds no list
 */
function matrixLiterals(text: string, key: string): string[] {
  const flow = new RegExp(`^[ \\t]*${key}:[ \\t]*\\[([^\\]]*)\\]`, 'm').exec(text);
  if (flow !== null) {
    return (flow[1] ?? '')
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter((item) => item !== '');
  }

  const block = new RegExp(
    `^([ \\t]*)${key}:[ \\t]*\\n((?:\\1[ \\t]+-[ \\t]*\\S.*\\n)+)`,
    'm',
  ).exec(text);
  if (block === null) return [];

  return (block[2] ?? '')
    .split('\n')
    .map((line) => /^\s*-[ \t]*(?:'([^']+)'|"([^"]+)"|([^\s#'"]+))/.exec(line))
    .map((match) => (match === null ? '' : (match[1] ?? match[2] ?? match[3] ?? '')))
    .filter((item) => item !== '');
}

/**
 * Every Node version pinned anywhere in the workflow directory, matrix literals included.
 *
 * IT COLLECTED NEITHER UNTIL THE POST T064 REVIEW, WHILE THE COMMENT HERE SAID IT DID. The previous
 * version skipped a `${{ }}` expression on the stated ground that "the matrix it reads is a list of
 * literals this same function already collected from the `matrix:` block", and it collected nothing
 * from any `matrix:` block: the one pattern it ran matched `node-version:` alone. So `ci.yml`'s
 * `node: ['22.22.2', '24']`, which is the only place the whole suite's runtime is chosen, was the
 * one pin nothing read. A comment describing a second half that does not exist is worse than no
 * comment, because it is what a reader checks instead of the code.
 *
 * A MATRIX REFERENCE IS FOLLOWED RATHER THAN SKIPPED, so a key that holds no list is reported as a
 * step pinned to nothing instead of passing as a step with no pin.
 *
 * @param names - Workflow file names
 * @returns One entry per pin, however it was written
 */
function pinsIn(names: readonly string[]): Pin[] {
  return names.flatMap((workflow) => {
    const text = readFileSync(resolve(WORKFLOW_DIRECTORY, workflow), 'utf8');

    const literals = [...text.matchAll(LITERAL_PIN)].map((match) => ({
      workflow,
      version: match[1] ?? match[2] ?? match[3] ?? '',
      through: 'the step',
    }));

    const fromMatrix = [...text.matchAll(MATRIX_PIN)].flatMap((match) => {
      const key = match[1] ?? '';
      const values = matrixLiterals(text, key);

      // A reference to a key with no list is a step pinned to nothing, and it is reported as one
      // rather than dropped: an empty result here would read exactly like a step that has no pin.
      if (values.length === 0) return [{ workflow, version: '', through: `matrix.${key}` }];

      return values.map((version) => ({ workflow, version, through: `matrix.${key}` }));
    });

    return [...literals, ...fromMatrix];
  });
}

describe('the engines floor', () => {
  it('should be a full version rather than a range with no floor in it', () => {
    // Given
    const floor = declaredFloor();

    // Then
    expect(floor).toMatch(/^\d+\.\d+\.\d+$/);
    expect(validRange(declaredRange())).not.toBeNull();
  });

  it('should be the version the floor job pins', () => {
    // Given
    const floor = declaredFloor();

    // When
    const pinned = pinsIn(['ci.yml']).map((pin) => pin.version);

    // Then
    expect(pinned).toContain(floor);
  });

  it('should be checked by a job that runs the load script', () => {
    // Given
    const workflow = readFileSync(resolve(WORKFLOW_DIRECTORY, 'ci.yml'), 'utf8');

    // Then
    // Named rather than pattern matched: this is the one step whose absence would leave the
    // floor pinned, the job green, and nothing loaded on it.
    expect(workflow).toContain('node tools/module-floor-check.mjs');
  });

  it('should have the two release workflows among the files it reads, before comparing anything', () => {
    // Given, the proof of absence below is worth nothing unless the subject was present. The
    // release pair is named because they are the files the T064 finding was about.
    // When
    const files = workflowFiles();

    // Then
    expect(files).toContain('release.yml');
    expect(files).toContain('release-license-audit.yml');
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('should read the matrix literals of ci.yml, before anything is compared', () => {
    // Given, the matrix is the only place the whole suite's runtime is chosen, and it was the one
    // pin nothing read. A proof of absence below is worth nothing unless this subject is present.
    // When
    const fromMatrix = pinsIn(['ci.yml']).filter((pin) => pin.through.startsWith('matrix.'));

    // Then
    expect(fromMatrix.length).toBeGreaterThanOrEqual(2);
    expect(fromMatrix.every((pin) => pin.version !== '')).toBe(true);
  });

  it('should pin no Node version the declared range excludes, in any workflow', () => {
    // Given, the comparison is exact rather than an intersection, and the difference is a real
    // hole this repository was standing in. `intersects('24', '^22.22.2 || ^24.15.0 || >=26.0.0')`
    // is true, because 24.15.0 is in both, so a bare `24` passed while naming every 24.x from
    // 24.0.0 up. `actions/setup-node` resolves a bare major out of the runner's tool cache, so the
    // job could land on any of them. Measured on 2026-09-01: the machine this was written on runs
    // v24.14.1, which is inside `24` and outside the declared range, and pnpm says so on every
    // command it runs there. `subset` asks the question that was meant: is every version this pin
    // admits a version this project promises to support.
    const range = declaredRange();
    const files = workflowFiles();

    // When
    const pins = pinsIn(files);
    const excluded = pins.filter(
      (pin) => validRange(pin.version) === null || !subset(pin.version, range),
    );

    // Then, an empty sweep is not a clean one: the pins have to have been found first.
    expect(pins.length).toBeGreaterThan(0);
    expect(excluded.map((pin) => `${pin.workflow} (${pin.through}): ${pin.version}`)).toEqual([]);
  });

  it('should pin a Node version in every workflow that sets Node up at all', () => {
    // Given, a workflow with a setup-node step and no pin takes whatever the runner has, which
    // is the same blind spot one level quieter.
    const files = workflowFiles();

    // When
    const setUp = files.filter((workflow) =>
      readFileSync(resolve(WORKFLOW_DIRECTORY, workflow), 'utf8').includes('actions/setup-node'),
    );
    const pinned = new Set(pinsIn(files).map((pin) => pin.workflow));

    // Then
    expect(setUp.length).toBeGreaterThan(0);
    expect(setUp.filter((workflow) => !pinned.has(workflow))).toEqual([]);
  });
});

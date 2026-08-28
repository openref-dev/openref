import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { builtCliProblem, BUILT_CLI_BIN } from '../../../../vitest.built-cli.ts';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The built binary, spawned as a real process, for the two claims nothing in-process can prove:
 * that the process really carries the exit code out, and that a hung `close()` really cannot
 * keep the process alive past its timeout. `process.exit` inside a vitest worker would kill the
 * worker, so the force close path in particular has no in-process equivalent.
 *
 * REQUIRES `packages/cli` BUILT FIRST, AND SAYS SO RATHER THAN SKIPPING. This suite used to skip
 * itself in silence when `dist/bin.js` was absent, and it looked at absence alone, so a green run
 * here could mean the suite ran, mean it never existed, or mean it ran against a bundle older than
 * the sources it was built from. All three are now distinguishable: see `vitest.built-cli.ts`.
 */
const execFileAsync = promisify(execFile);
const BIN_PATH = BUILT_CLI_BIN;
const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../mocks/from-nest/', import.meta.url));
const DEMO_ENTRY = fileURLToPath(
  new URL('../../../../examples/nest-minimal/dist/main.js', import.meta.url),
);

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCliBinary(
  args: readonly string[],
  options: { readonly cwd?: string } = {},
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN_PATH, ...args], options);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Runs one git command in a directory, failing loudly rather than leaving a half built history. */
async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync(
    'git',
    [
      '-c',
      'user.email=t@openref.test',
      '-c',
      'user.name=openref test',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd },
  );
}

describe('the built openref binary', () => {
  beforeAll(() => {
    // NOT A SKIP. The message names the artifact and the command that produces it.
    const problem = builtCliProblem();
    if (problem !== undefined) throw new Error(problem);
  });

  it('should be running against a built and current binary rather than skipping itself', () => {
    // Given: every case below spawns this file, so its provenance is asserted, not assumed
    // When / Then
    expect(builtCliProblem()).toBeUndefined();
    expect(existsSync(BIN_PATH)).toBe(true);
  });

  it('should exit 2 and print usage on stderr with no arguments, never throwing raw', async () => {
    // When
    const result = await runCliBinary([]);

    // Then
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('a command is required');
    expect(result.stderr).not.toContain('at ');
  });

  it('should exit 0 and print usage on stdout for --help', async () => {
    // When
    const result = await runCliBinary(['--help']);

    // Then
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('openref build');
  });

  it('should exit 0 for build --spec against a real file on disk', async () => {
    // Given: `--out` is required since T039, because a build has no defensible default
    // directory and picking one would write files somewhere the caller never named.
    const spec = resolve(MOCKS, 'mini-spec.json');
    const out = await mkdtemp(join(tmpdir(), 'openref-binary-build-'));

    // When
    const result = await runCliBinary(['build', `--spec=${spec}`, `--out=${out}`]);

    // Then
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Built 5 pages');
    expect(await readFile(join(out, 'get-ping', 'index.html'), 'utf8')).toContain(
      '<!DOCTYPE html>',
    );
    await rm(out, { recursive: true, force: true });
  });

  it(
    'should deploy the static site out of the example application, which is the M3 definition of done',
    async () => {
      // Given the clause of the M3 definition of done that had no runner until T042. SPEC 22 says
      // the milestone is done when the static build deploys from the example, and every case
      // beside this one drives the CLI from a specification file: the example was loaded by
      // `doctor` and by `lint` and never by `build`, so nothing anywhere ran the one sentence the
      // milestone is judged on. `--from-nest` is the whole difference: the document comes out of a
      // booted NestJS application with its collectors, not off disk.
      //
      // AND IT SAYS SO RATHER THAN SKIPPING, unlike its neighbours, for the reason the built
      // binary check at the top of this file gives: a milestone's definition of done that skips
      // itself in silence when the demo is unbuilt is a definition of done nothing enforces.
      if (!existsSync(DEMO_ENTRY)) {
        throw new Error(
          `${DEMO_ENTRY} is not built, so the M3 definition of done was not checked. Run pnpm run build`,
        );
      }

      const out = await mkdtemp(join(tmpdir(), 'openref-binary-deploy-'));

      // When
      const result = await runCliBinary([
        'build',
        `--from-nest=${DEMO_ENTRY}`,
        `--out=${out}`,
        '--base=https://docs.example.com/reference',
        '--target=netlify',
      ]);

      // Then a directory a host can serve as it stands: an entry page, a page per node, the two
      // payloads a page fetches for itself, and the files an absolute base earns.
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/Built \d+ pages/);

      const index = await readFile(join(out, 'index.html'), 'utf8');
      expect(index).toContain('<!DOCTYPE html>');
      expect(index).toContain('Orders');
      expect(await readFile(join(out, 'get-orders', 'index.html'), 'utf8')).toContain(
        '<!DOCTYPE html>',
      );

      for (const file of ['_search-index', '_navigation', 'sitemap.xml', 'llms.txt', '_assets']) {
        expect(existsSync(join(out, file))).toBe(true);
      }

      // AND THE PROXY STEP SAID WHY IT WROTE NOTHING, WHICH IS THE FINDING THIS CASE MADE. The
      // demo declares a relative server, so there is no absolute upstream to pin and SPEC 16.2
      // has nothing to generate. That is the correct outcome and the reason is printed rather
      // than left as an empty directory: a silent `--target netlify` producing no rules is
      // indistinguishable from a broken one. The rules themselves are proved against documents
      // that do pin an upstream, in `packages/static/test/unit/build-proxy.spec.ts` and
      // `packages/static/test/integration/proxy-config-tools.spec.ts`.
      expect(result.stdout).toContain('netlify: nothing generated');
      expect(result.stdout).toContain('declares no absolute http(s) server');
      expect(existsSync(join(out, '_redirects'))).toBe(false);

      await rm(out, { recursive: true, force: true });
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should catch a breaking change between two commits of one specification, which is the M3 definition of done',
    async () => {
      // Given the clause SPEC 22 judges M3 on, in its own words: `diff` catches breaking changes
      // on a real specification history. Until T042 every case of this command ran over two files
      // side by side, which is not a history, and the git ref sides were proved separately against
      // this repository's own HEAD. This is the whole sentence: one file, two commits, the change
      // between them, read through the `<ref>:<path>` spelling a caller types.
      const repo = await mkdtemp(join(tmpdir(), 'openref-history-'));
      const older = await readFile(resolve(MOCKS, 'diff-old.json'), 'utf8');
      const newer = await readFile(resolve(MOCKS, 'diff-new.json'), 'utf8');

      await git(repo, ['init', '-b', 'main']);
      await writeFile(join(repo, 'api.json'), older);
      await git(repo, ['add', 'api.json']);
      await git(repo, ['commit', '-m', 'the published contract']);
      await writeFile(join(repo, 'api.json'), newer);
      await git(repo, ['commit', '-a', '-m', 'the change under review']);

      // When
      const result = await runCliBinary(['diff', 'HEAD~1:api.json', 'HEAD:api.json'], {
        cwd: repo,
      });

      // Then the breaking changes are named and the process carries the 1 a pipeline reads.
      // THE ABSENCE IS SHOWN ABLE TO SEE, per SPEC 0: the same two revisions against themselves
      // exit 0 and print no BREAKING block, so exit 1 is a fact about the change rather than
      // about a command that fails on every history.
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('BREAKING');
      expect(result.stdout).toContain('DELETE /users/{id}');

      const unchanged = await runCliBinary(['diff', 'HEAD:api.json', 'HEAD:api.json'], {
        cwd: repo,
      });
      expect(unchanged.code).toBe(0);
      expect(unchanged.stdout).not.toContain('BREAKING');

      await rm(repo, { recursive: true, force: true });
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it('should carry exit code 1 out of the process for a diff with breaking changes', async () => {
    // Given the pair built to produce the SPEC 17.1 example. The unit suite proves the outcome
    // object; only a spawned process proves the 1 actually reaches a pipeline, and no other
    // case in this suite exits 1.
    const older = resolve(MOCKS, 'diff-old.json');
    const newer = resolve(MOCKS, 'diff-new.json');

    // When
    const result = await runCliBinary(['diff', older, newer]);

    // Then
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('BREAKING');
    expect(result.stdout).toContain('DELETE /users/{id}');
  });

  it(
    'should carry a non zero exit code out of the process for doctor on drift, which is the M3 definition of done',
    async () => {
      // Given the third clause SPEC 22 judges M3 on: `doctor` fails the pipeline on drift. The
      // threshold behaviour is proved on the outcome object in `doctor-command.spec.ts`; what
      // only a spawned process can prove is that the code leaves the process, and a pipeline
      // reads nothing else. The fixture is the one that carries an error severity finding.
      const entry = resolve(FIXTURES, 'error-drift.mjs');

      // THE CONTROL COMES FIRST AND IT IS THE SAME DRIFT. Without `--fail-on` the command finds
      // the same thing and exits 0, per SPEC 17, so the 1 below is the threshold doing its work
      // rather than a fixture that fails whatever is asked of it.
      const quiet = await runCliBinary(['doctor', `--from-nest=${entry}`]);

      // When the pipeline asks to be failed on drift
      const result = await runCliBinary(['doctor', `--from-nest=${entry}`, '--fail-on=drift']);

      // Then
      expect(quiet.code).toBe(0);
      expect(quiet.stdout).toContain('DRIFT');
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('DRIFT');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!existsSync(DEMO_ENTRY))(
    'should exit 0 for doctor --from-nest against the real demo application',
    async () => {
      // When
      const result = await runCliBinary(['doctor', `--from-nest=${DEMO_ENTRY}`]);

      // Then
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Orders 1.0.0');
    },
    // Booting the real demo application in a spawned node is the class the constant names:
    // under full suite load this case has missed the five second default while passing alone.
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should force close and exit after the application does not close in time, and say so',
    async () => {
      // Given
      const entry = resolve(FIXTURES, 'hangs-on-close.mjs');
      const started = Date.now();

      // When
      const result = await runCliBinary(['doctor', `--from-nest=${entry}`]);
      const elapsedMs = Date.now() - started;

      // Then
      expect(result.stdout).toContain('Hangy 1.0.0');
      expect(result.stderr).toContain('did not close within 5000ms and is being terminated');
      expect(result.code).toBe(0);
      // Proves the process did not hang forever on the open handle: bounded well under the
      // spawned-process budget, comfortably above the 5000ms the fixture is built to miss.
      expect(elapsedMs).toBeGreaterThanOrEqual(5000);
      expect(elapsedMs).toBeLessThan(SPAWNED_PROCESS_TIMEOUT_MS);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

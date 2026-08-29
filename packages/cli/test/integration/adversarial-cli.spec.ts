import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carriesControlCharacters } from '@openref/core';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * `T043`'s driven cases against the built binary, through a real pipe and a real process.
 *
 * A REAL PROCESS BECAUSE BOTH PROPERTIES ARE ABOUT ONE. What a command writes to a terminal only
 * exists once something is on the other end of a pipe, and what `process.exit` discards only
 * exists once the process is exiting. Neither can be seen from inside a test's own call.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const BIN = join(REPO_ROOT, 'packages', 'cli', 'dist', 'bin.js');
const fixture = (name: string): string =>
  join(REPO_ROOT, 'packages', 'cli', 'test', 'mocks', 'from-nest', `${name}.mjs`);

const TIMER_FIXTURE = fixture('leaves-a-timer');

/** How long a run is given before it is called hung. */
const RUN_TIMEOUT_MS = 30_000;

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** Runs the built binary and collects everything it wrote. */
function run(args: readonly string[]): Promise<Run> {
  return new Promise<Run>((done) => {
    const child = spawn(process.execPath, [BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, RUN_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, timedOut });
    });
  });
}

const ch = (code: number): string => String.fromCharCode(code);

/** Every character SPEC 19.1 says a plain text artefact must not repeat. */
const PAYLOAD = `${ch(0x00)}${ch(0x1b)}[31m${ch(0x202e)}${ch(0x2028)}`;

describe('the built openref binary, driven by T043', () => {
  let workspace = '';
  let hostileSpec = '';
  let cleanSpec = '';

  beforeAll(async () => {
    // A STALE OR ABSENT DIST FAILS THIS SUITE BY NAME, per the T041 mechanism, rather than
    // letting every case below pass over a binary nobody built.
    expect(existsSync(BIN), `${BIN} is missing: run pnpm build before this suite`).toBe(true);

    workspace = await mkdtemp(join(tmpdir(), 'openref-adversarial-'));

    hostileSpec = join(workspace, 'hostile.json');
    await writeFile(
      hostileSpec,
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: `Refund${PAYLOAD}Service`, version: `1.0${PAYLOAD}` },
        paths: {
          '/refund': {
            get: {
              summary: `Read${PAYLOAD}a refund`,
              responses: { 200: { description: `ok${PAYLOAD}` } },
            },
          },
        },
      }),
      'utf8',
    );

    cleanSpec = join(workspace, 'clean.json');
    await writeFile(
      cleanSpec,
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Clean', version: '1.0.0' },
        paths: { '/a': { get: { operationId: 'a', responses: { 200: { description: 'ok' } } } } },
      }),
      'utf8',
    );
  });

  afterAll(async () => {
    if (workspace !== '') await rm(workspace, { recursive: true, force: true });
  });

  describe('a document whose strings carry control characters, per SPEC 19.1', () => {
    it.each([
      ['preview', (): readonly string[] => ['preview', '--spec', hostileSpec]],
      ['lint', (): readonly string[] => ['lint', hostileSpec]],
      ['build', (): readonly string[] => ['build', '--spec', hostileSpec, '--out', workspace]],
      ['diff', (): readonly string[] => ['diff', cleanSpec, hostileSpec]],
    ])(
      'should write neither a control character nor an override from %s',
      async (_name, args) => {
        // Given the hostile specification written above
        // Then, before the run: the file really does carry them.
        expect(carriesControlCharacters(PAYLOAD)).toBe(true);

        // When
        const result = await run(args());

        // Then: it ran, it said something about the document, and it said it in text.
        expect(result.timedOut).toBe(false);
        expect(`${result.stdout}${result.stderr}`.length).toBeGreaterThan(0);
        expect(carriesControlCharacters(result.stdout)).toBe(false);
        expect(carriesControlCharacters(result.stderr)).toBe(false);
      },
      SPAWNED_PROCESS_TIMEOUT_MS,
    );

    it(
      'should still print the words around the payload, so the filter is not a mute',
      async () => {
        // Given

        // When
        const result = await run(['preview', '--spec', hostileSpec]);

        // Then
        expect(result.stdout).toContain('Refund');
        expect(result.stdout).toContain('Service');
      },
      SPAWNED_PROCESS_TIMEOUT_MS,
    );
  });

  describe('the three boot shapes the task names, each committed as a fixture', () => {
    it.each([
      ['a scheduler', 'leaves-a-timer', 'Timeout'],
      ['a connection it never gave back', 'opens-a-connection', 'TCPSERVERWRAP'],
    ])(
      'should end the run rather than wait, for %s',
      async (_reason, name, handle) => {
        // Given the committed fixture, booted through the real `--from-nest` path

        // When
        const result = await run(['doctor', '--from-nest', fixture(name)]);

        // Then: it left, it said so, and it named what it found.
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(0);
        expect(result.stderr.toUpperCase()).toContain(handle.toUpperCase());
      },
      SPAWNED_PROCESS_TIMEOUT_MS,
    );

    it(
      'should say nothing and leave on its own for a boot that only wrote to disk',
      async () => {
        // Given: the control of the three. A side effect at boot is not by itself a reason to force
        // anything, and without this case the other two would only show that the CLI can force an
        // exit, never that it declines to.

        // When
        const result = await run(['doctor', '--from-nest', fixture('writes-to-disk')]);

        // Then
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout).toContain('WritesToDisk');
      },
      SPAWNED_PROCESS_TIMEOUT_MS,
    );
  });

  describe('an application that starts a scheduler and does not stop it', () => {
    it(
      'should exit rather than wait for a handle it cannot reach, and name what it found',
      async () => {
        // Given the committed fixture, booted through the real `--from-nest` path

        // When
        const result = await run(['doctor', '--from-nest', TIMER_FIXTURE]);

        // Then
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(0);
        expect(result.stderr).toContain('Timeout');
        expect(result.stderr).toContain('left');
      },
      SPAWNED_PROCESS_TIMEOUT_MS,
    );

    it(
      'should deliver everything it wrote before ending the process, past any pipe buffer',
      async () => {
        // Given a report far larger than a pipe holds unread: without the flush before
        // `process.exit`, this arrives cut at exactly the buffer size and does not parse.

        // When
        const result = await run(['doctor', '--from-nest', TIMER_FIXTURE, '--json']);

        // Then
        expect(result.timedOut).toBe(false);
        expect(result.stdout.length).toBeGreaterThan(200_000);
        expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
      },
      SPAWNED_PROCESS_TIMEOUT_MS,
    );
  });
});

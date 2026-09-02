import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '@openref/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfigDocument } from '../../src/cli/infrastructure/adapters/config-document.adapter';
import { refusedNonRegularFile } from '../../src/cli/infrastructure/adapters/regular-file.adapter';
import { loadSpecDocument } from '../../src/cli/infrastructure/adapters/spec-document.adapter';

/**
 * The CLI opens no path without asking what the entry is, per the `T065` section.
 *
 * WHY A REAL FIFO AND NOT A DOUBLE. `readFile` on a named pipe blocks until a writer appears, and
 * that is a property of the operating system rather than of this code, so a stubbed `stat` would
 * prove the guard is called and not that the hang is gone. Measured before the fix, on the built
 * binary: `openref lint pipe.yaml`, `openref build --spec pipe.yaml` and
 * `openref diff pipe.yaml pipe.yaml` each ran past six seconds with nothing on stdout and nothing
 * on stderr and had to be killed. Every case below therefore drives a pipe that has no writer, and
 * a fix that only reordered the code would leave them hanging until vitest killed the file.
 */

const DOCUMENT = `openapi: 3.1.0
info: { title: Pipes, version: '1' }
paths:
  /a:
    get:
      responses:
        '200': { description: ok }
`;

let root: string;
let pipe: string;
let real: string;
let link: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'openref-fifo-'));
  pipe = join(root, 'pipe.yaml');
  real = join(root, 'real.yaml');
  link = join(root, 'link.yaml');
  execFileSync('mkfifo', [pipe]);
  writeFileSync(real, DOCUMENT, 'utf8');
  symlinkSync(real, link);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a path the CLI was handed', () => {
  it('should be a real named pipe with no writer, before anything is claimed about it', () => {
    // Given, the subject has to be present: a case that refused an ordinary file would pass too.
    const entry = statSync(pipe);

    // Then
    expect(entry.isFIFO()).toBe(true);
    expect(entry.isFile()).toBe(false);
  });

  it('should refuse a named pipe as a specification, naming the path and what it is', async () => {
    // When
    const act = loadSpecDocument(pipe);

    // Then
    await expect(act).rejects.toBeInstanceOf(UsageError);
    await expect(act).rejects.toThrow(pipe);
    await expect(act).rejects.toThrow('a named pipe');
  }, 5_000);

  it('should refuse a named pipe as a config file', async () => {
    // When
    const act = loadConfigDocument(pipe);

    // Then
    await expect(act).rejects.toBeInstanceOf(UsageError);
    await expect(act).rejects.toThrow('a named pipe');
  }, 5_000);

  it('should refuse a named pipe a config file names as its specification', async () => {
    // Given
    const config = join(root, 'openref.json');
    writeFileSync(config, JSON.stringify({ spec: 'pipe.yaml' }), 'utf8');

    // When
    const act = loadConfigDocument(config);

    // Then
    await expect(act).rejects.toThrow('a named pipe');
  }, 5_000);

  it('should refuse a directory by name rather than by the system error', async () => {
    // Given
    const directory = join(root, 'adir');
    mkdirSync(directory, { recursive: true });

    // When
    const reason = await refusedNonRegularFile(directory);

    // Then
    expect(reason).toContain('a directory');
    expect(reason).toContain('rather than a regular file');
  });

  it('should follow a symbolic link to a real document, since stat and not lstat is the question', async () => {
    // Given, the subject is present: the entry really is a link.
    expect(statSync(link, { throwIfNoEntry: true }).isFile()).toBe(true);

    // When
    const loaded = await loadSpecDocument(link);

    // Then
    expect(loaded.document.info.title).toBe('Pipes');
    expect(await refusedNonRegularFile(link)).toBeUndefined();
  });

  it('should leave an absent path to the read, so one failure is not reported twice', async () => {
    // Given
    const missing = join(root, 'nowhere.yaml');

    // When
    const reason = await refusedNonRegularFile(missing);

    // Then, this check says nothing, and the read below still refuses with the system's reason.
    expect(reason).toBeUndefined();
    await expect(loadSpecDocument(missing)).rejects.toThrow('could not read');
  });

  it('should describe an entry in the same words the Nuxt half uses', async () => {
    // Given, one rule lives in two packages because `@openref/core` is in the browser bundle and
    // may carry no `node:fs` call. What can be held is that the two say the same thing.
    const { readFileSync } = await import('node:fs');
    const here = readFileSync(
      new URL('../../src/cli/infrastructure/adapters/regular-file.adapter.ts', import.meta.url),
      'utf8',
    );
    const there = readFileSync(
      new URL(
        '../../../nuxt/src/document/application/services/load-specification.service.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const phrases = (source: string): string[] =>
      [...source.matchAll(/return '(a [a-z ]+|not a regular file)';/g)].map(
        (match) => match[1] ?? '',
      );

    // Then, both directions and non empty, so a list that lost its matcher cannot pass.
    expect(phrases(here)).toEqual([
      'a directory',
      'a named pipe',
      'a socket',
      'a device node',
      'not a regular file',
    ]);
    expect(phrases(there)).toEqual(phrases(here));
  });
});

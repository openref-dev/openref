import { ErrorCode, ShutdownTimeoutError, type IRDocument } from '@openref/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandIo } from '../../src/cli/domain/command.types';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';

const loadDocumentMock = vi.fn();

vi.mock('../../src/cli/application/services/load-document.service', () => ({
  loadDocument: (...args: unknown[]): unknown => loadDocumentMock(...args),
}));

const { runWithDocument } =
  await import('../../src/cli/application/services/run-with-document.service');

const FAKE_DOCUMENT = {} as IRDocument;

function fakeIo(): CommandIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
}

describe('runWithDocument', () => {
  beforeEach(() => {
    loadDocumentMock.mockReset();
  });

  it('should report the load error and exit with a usage error when loading fails', async () => {
    // Given
    loadDocumentMock.mockRejectedValue(new Error('nope'));
    const io = fakeIo();

    // When
    const outcome = await runWithDocument({ kind: 'spec', path: 'x' }, io, () =>
      Promise.resolve({ exitCode: EXIT_CODE.SUCCESS }),
    );

    // Then
    expect(outcome).toEqual({ exitCode: EXIT_CODE.USAGE_ERROR });
    expect(io.err[0]).toContain('nope');
  });

  it('should run the action over the loaded document and close it, forcedShutdown false', async () => {
    // Given
    const close = vi.fn().mockResolvedValue(undefined);
    loadDocumentMock.mockResolvedValue({ document: FAKE_DOCUMENT, close });
    const io = fakeIo();

    // When
    const outcome = await runWithDocument({ kind: 'spec', path: 'x' }, io, (document) => {
      expect(document).toBe(FAKE_DOCUMENT);
      return Promise.resolve({ exitCode: EXIT_CODE.SUCCESS });
    });

    // Then
    expect(outcome).toEqual({ exitCode: EXIT_CODE.SUCCESS, forcedShutdown: false });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('should flag forcedShutdown and report the timeout without failing the action outcome', async () => {
    // Given
    const close = vi
      .fn()
      .mockRejectedValue(
        new ShutdownTimeoutError('did not close within 5000ms', ErrorCode.CLI_SHUTDOWN_TIMEOUT),
      );
    loadDocumentMock.mockResolvedValue({ document: FAKE_DOCUMENT, close });
    const io = fakeIo();

    // When
    const outcome = await runWithDocument({ kind: 'spec', path: 'x' }, io, () =>
      Promise.resolve({ exitCode: EXIT_CODE.SUCCESS }),
    );

    // Then
    expect(outcome).toEqual({ exitCode: EXIT_CODE.SUCCESS, forcedShutdown: true });
    expect(io.err.some((line) => line.includes('did not close within 5000ms'))).toBe(true);
  });

  it('should still attempt to close when the action throws, and report the action error', async () => {
    // Given
    const close = vi.fn().mockResolvedValue(undefined);
    loadDocumentMock.mockResolvedValue({ document: FAKE_DOCUMENT, close });
    const io = fakeIo();

    // When
    const outcome = await runWithDocument({ kind: 'spec', path: 'x' }, io, () => {
      throw new Error('action blew up');
    });

    // Then
    expect(outcome).toEqual({ exitCode: EXIT_CODE.USAGE_ERROR, forcedShutdown: false });
    expect(close).toHaveBeenCalledTimes(1);
    expect(io.err[0]).toContain('action blew up');
  });
});

/**
 * The `T043` finding that `close` returning is not the same as the process being able to leave.
 *
 * SPEC 17 PROMISED A FORCED SHUTDOWN AND COVERED ONE CASE OF TWO. The timeout above is `close`
 * hanging; this is `close` resolving at once while the application still holds a handle it
 * opened during boot. Measured before the fix: `doctor --from-nest` against an entry calling
 * `setInterval` printed its whole report and then never exited, because nothing forced the point
 * and Node waits for a refed timer forever.
 */
describe('runWithDocument, an application that leaves a handle open', () => {
  it('should name the handle and force the shutdown when a booted application keeps the loop alive', async () => {
    // Given: an application whose close resolves, having left a timer running.
    let timer: ReturnType<typeof setInterval> | undefined;
    loadDocumentMock.mockImplementation(() => {
      timer = setInterval(() => undefined, 1000);
      return Promise.resolve({ document: FAKE_DOCUMENT, close: () => Promise.resolve() });
    });
    const io = fakeIo();

    // When
    const outcome = await runWithDocument({ kind: 'from-nest', path: 'app.mjs' }, io, () =>
      Promise.resolve({ exitCode: EXIT_CODE.SUCCESS }),
    );
    clearInterval(timer);

    // Then
    expect(outcome.forcedShutdown).toBe(true);
    expect(io.err.join('')).toContain('Timeout');
    expect(io.err.join('')).toContain('left');
  });

  it('should say nothing and not force when a booted application leaves nothing behind', async () => {
    // Given
    loadDocumentMock.mockResolvedValue({
      document: FAKE_DOCUMENT,
      close: () => Promise.resolve(),
    });
    const io = fakeIo();

    // When
    const outcome = await runWithDocument({ kind: 'from-nest', path: 'app.mjs' }, io, () =>
      Promise.resolve({ exitCode: EXIT_CODE.SUCCESS }),
    );

    // Then
    expect(outcome).toEqual({ exitCode: EXIT_CODE.SUCCESS, forcedShutdown: false });
    expect(io.err).toEqual([]);
  });

  it('should not look at handles for a source this package reads itself', async () => {
    // Given: a spec file, where every handle opened belongs to this package and answering for
    // an application's leftovers would be answering for its own reads.
    let timer: ReturnType<typeof setInterval> | undefined;
    loadDocumentMock.mockImplementation(() => {
      timer = setInterval(() => undefined, 1000);
      return Promise.resolve({ document: FAKE_DOCUMENT, close: () => Promise.resolve() });
    });
    const io = fakeIo();

    // When
    const outcome = await runWithDocument({ kind: 'spec', path: 'x.json' }, io, () =>
      Promise.resolve({ exitCode: EXIT_CODE.SUCCESS }),
    );
    clearInterval(timer);

    // Then
    expect(outcome.forcedShutdown).toBe(false);
    expect(io.err).toEqual([]);
  });
});

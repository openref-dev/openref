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

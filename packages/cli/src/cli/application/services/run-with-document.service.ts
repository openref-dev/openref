import { ShutdownTimeoutError, type IRDocument } from '@openref/core';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import type { CommandIo, CommandOutcome } from '../../domain/command.types';
import type { DocumentSource } from '../../domain/loaded-document.types';
import { loadDocument } from './load-document.service';

/**
 * Loads a document, runs a command's action over it, and always attempts to close it, whether
 * the action succeeded or threw.
 *
 * THE CLOSE IS ATTEMPTED EXACTLY ONCE, ON BOTH BRANCHES. A plain `finally` would do that too,
 * but could not also report a timeout without either overriding the action's own error or being
 * silently dropped by one, so this reports it explicitly on both branches and returns it on the
 * outcome rather than throwing it.
 *
 * NEVER THROWS. Every error is turned into a message on `io.stderr` and an
 * {@link CommandOutcome.exitCode}, per `T036`'s own "no arguments without throwing" requirement.
 */
export async function runWithDocument(
  source: DocumentSource,
  io: CommandIo,
  action: (document: IRDocument) => Promise<CommandOutcome>,
): Promise<CommandOutcome> {
  const loaded = await loadDocument(source).catch((error: unknown) => {
    io.stderr(`openref: ${describeError(error)}\n`);
    return undefined;
  });

  if (loaded === undefined) {
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  let forcedShutdown = false;
  const close = async (): Promise<void> => {
    try {
      await loaded.close();
    } catch (error) {
      if (!(error instanceof ShutdownTimeoutError)) throw error;
      io.stderr(`openref: ${error.message}\n`);
      forcedShutdown = true;
    }
  };

  try {
    const outcome = await action(loaded.document);
    await close();
    return { ...outcome, forcedShutdown };
  } catch (error) {
    await close();
    io.stderr(`openref: ${describeError(error)}\n`);
    return { exitCode: EXIT_CODE.USAGE_ERROR, forcedShutdown };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

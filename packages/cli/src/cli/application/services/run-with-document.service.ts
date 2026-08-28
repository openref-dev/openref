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
 *
 * AND IT ANSWERS FOR THE PROCESS, NOT ONLY FOR `close`, since `T043`. SPEC 17 promised that an
 * application which does not shut down is forced and said so; the promise covered `close` hanging
 * and nothing else, so an application whose `close` resolved at once while a scheduler it started
 * during boot kept a timer refed left the CLI running forever with its report already printed.
 * Measured: `doctor --from-nest` against an entry that calls `setInterval` never exited. The
 * handles alive before the boot are compared with the handles alive after the close, and anything
 * the application added is named and forced, because the CLI cannot reach into foreign code to
 * close what it did not open.
 */
export async function runWithDocument(
  source: DocumentSource,
  io: CommandIo,
  action: (document: IRDocument) => Promise<CommandOutcome>,
): Promise<CommandOutcome> {
  const before = source.kind === 'from-nest' ? activeHandles() : [];

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

    // ONLY WHERE FOREIGN CODE RAN, AND ONLY AFTER THE LOOP HAS TURNED. A spec or a git side is
    // read by this package's own code, so every handle it opened is this package's to answer for,
    // and a read still settling would otherwise read as an application's leftover.
    if (source.kind !== 'from-nest') return;
    await new Promise<void>((done) => {
      setImmediate(done);
    });

    const leftOpen = handlesAddedSince(before);
    if (leftOpen.length > 0) {
      io.stderr(
        `openref: the application left ${String(leftOpen.length)} handle(s) open after it ` +
          `closed (${leftOpen.join(', ')}), so the process is being ended rather than waiting ` +
          'for them\n',
      );
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

/**
 * The kinds of handle keeping this process alive right now, as a sorted multiset.
 *
 * KINDS RATHER THAN IDENTITIES, because that is all Node offers: `getActiveResourcesInfo` returns
 * a name per resource and no way to ask which of them is which. Counting kinds is enough for the
 * question here, which is whether the application added anything.
 */
function activeHandles(): readonly string[] {
  // THE STANDARD STREAMS ARE BUILT ON FIRST TOUCH, so a baseline taken before anything was
  // written did not have them and every run over a pipe reported a `PipeWrap` the application
  // never opened. Touching them here puts them in both samples, where they belong.
  void process.stdout.writableLength;
  void process.stderr.writableLength;

  return [...process.getActiveResourcesInfo()].sort();
}

/**
 * What is alive now that was not alive before, as a multiset difference.
 *
 * THE CLI'S OWN HANDLES ARE THE BASELINE AND ARE SUBTRACTED, so the standard streams, the
 * loaders and everything else this process opens for itself never reads as an application's
 * leftover. The remainder is what the boot added and the close did not take away.
 *
 * @param before - The kinds alive before the application was loaded
 * @returns The kinds the application is still holding
 */
function handlesAddedSince(before: readonly string[]): readonly string[] {
  const budget = new Map<string, number>();
  for (const kind of before) budget.set(kind, (budget.get(kind) ?? 0) + 1);

  const added: string[] = [];
  for (const kind of activeHandles()) {
    const remaining = budget.get(kind) ?? 0;
    if (remaining > 0) budget.set(kind, remaining - 1);
    else added.push(kind);
  }

  return added;
}

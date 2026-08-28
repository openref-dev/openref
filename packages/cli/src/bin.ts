#!/usr/bin/env node
import { runCli } from './cli/application/services/run-cli.service';

/**
 * Waits for one stream to have taken everything written to it.
 *
 * `process.exit` DISCARDS WHAT A PIPE HAS NOT ACCEPTED YET, and the forced path below is exactly
 * the one whose report matters most: a run that says on stderr why it is ending must not lose
 * that line to the ending. Writing an empty chunk answers false while the stream is backed up,
 * and `drain` fires when it is not.
 */
function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise<void>((done) => {
    if (stream.write('')) done();
    else
      stream.once('drain', () => {
        done();
      });
  });
}

void (async (): Promise<void> => {
  const outcome = await runCli(process.argv.slice(2));

  if (outcome.forcedShutdown === true) {
    // An application from --from-nest would not close within its timeout, or closed and left a
    // handle of its own open. The reason is already on stderr; process.exitCode alone would wait
    // for that handle to drain, which is the hang this whole path exists to refuse.
    await flushed(process.stdout);
    await flushed(process.stderr);
    process.exit(outcome.exitCode);
  } else {
    process.exitCode = outcome.exitCode;
  }
})();

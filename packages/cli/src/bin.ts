#!/usr/bin/env node
import { runCli } from './cli/application/services/run-cli.service';

void (async (): Promise<void> => {
  const outcome = await runCli(process.argv.slice(2));

  if (outcome.forcedShutdown === true) {
    // An application from --from-nest left a handle open past its close timeout. The warning is
    // already on stderr; process.exitCode alone would wait for that handle to drain, which is
    // the hang this whole path exists to refuse.
    process.exit(outcome.exitCode);
  } else {
    process.exitCode = outcome.exitCode;
  }
})();

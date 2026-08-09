import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failedGateIds, runAllGates, STATUS_LABEL } from './run.js';

export { failedGateIds, GATES, runAllGates, selectGates, STATUS_LABEL } from './run.js';
export type { Gate, GateContext, GateFinding, GateResult, GateStatus } from './types.js';

/**
 * Entry point for `pnpm gates`.
 *
 * Command line arguments name the gates to run. With none, every gate runs.
 */
async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const write = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  const results = await runAllGates(repoRoot, write, process.argv.slice(2));

  write('\n=== gate summary ===');
  for (const result of results) {
    write(`  ${STATUS_LABEL[result.status].padEnd(4)} ${result.id}`);
  }

  const failed = failedGateIds(results);
  if (failed.length > 0) {
    write(`\n${String(failed.length)} gate(s) failed: ${failed.join(', ')}`);
    write('Fix the code. Never the gate.');
    process.exitCode = 1;
    return;
  }

  write('\nall gates green');
}

await main();

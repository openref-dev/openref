import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiDocsPresent } from './lib/ai-docs.js';
import { accountForSkips, skipAccountingFailed } from './lib/skip-accounting.js';
import { failedGateIds, runAllGates, STATUS_LABEL } from './run.js';

export { failedGateIds, GATES, runAllGates, selectGates, STATUS_LABEL } from './run.js';
export { accountForSkips, SKIP_REASONS, skipAccountingFailed } from './lib/skip-accounting.js';
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
    const reason = result.skipReason === undefined ? '' : `  (${result.skipReason})`;
    write(`  ${STATUS_LABEL[result.status].padEnd(4)} ${result.id}${reason}`);
  }

  // THE ONE THING CI CAN ENFORCE ON A CHECKOUT WITH NO PRIVATE DOCUMENTS. Four gates skip
  // there and document rather than enforce what they read. This says the skipping itself was
  // in order: every skip named a declared cause, the cause it named is true here, and no gate
  // that had to skip came out as a pass instead.
  const accounting = accountForSkips(results, { aiDocsPresent: aiDocsPresent(repoRoot) });
  write('\n=== skip accounting ===');
  if (accounting.length === 0) write('  nothing skipped');
  for (const finding of accounting) write(`  [${finding.level}] ${finding.message}`);

  const failed = failedGateIds(results);
  const unaccounted = skipAccountingFailed(accounting);

  if (failed.length > 0 || unaccounted) {
    if (failed.length > 0) write(`\n${String(failed.length)} gate(s) failed: ${failed.join(', ')}`);
    if (unaccounted) write('\nthe skips in this run are not accounted for');
    write('Fix the code. Never the gate.');
    process.exitCode = 1;
    return;
  }

  write('\nall gates green');
}

await main();

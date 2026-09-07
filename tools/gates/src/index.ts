import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_DOCS_DIR, aiDocsPresent } from './lib/ai-docs.js';
import { accountForSkips, SKIP_REASONS, skipAccountingFailed } from './lib/skip-accounting.js';
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

  // THE ONE THING CI CAN ENFORCE ON A CHECKOUT WITH NO PRIVATE DOCUMENTS. The gates that may skip
  // there document rather than enforce what they read, and HOW MANY THEY ARE IS PRINTED FROM
  // `SKIP_REASONS` RATHER THAN WRITTEN HERE. The sentence this replaces said four and was never
  // measured: the projection took it to two while this file went untouched, which is a count of
  // things in the repository asserted rather than read, and this run's third. `projection.spec.ts`
  // holds that list to the gates whose own source declares the reason, in both directions, so a
  // gate that starts or stops skipping cannot leave the number behind. What this section says is
  // that the skipping itself was in order: every skip named a declared cause, the cause it named is
  // true here, and no gate that had to skip came out as a pass instead.
  const withoutDocuments = SKIP_REASONS.find((reason) => reason.id === 'ai-docs-absent');
  const maySkip = withoutDocuments?.permitted ?? [];
  const accounting = accountForSkips(results, { aiDocsPresent: aiDocsPresent(repoRoot) });
  write('\n=== skip accounting ===');
  write(
    `  ${String(maySkip.length)} gate(s) may skip without ${AI_DOCS_DIR}/: ${maySkip.join(', ')}`,
  );
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

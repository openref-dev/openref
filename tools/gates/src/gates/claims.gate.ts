import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUDGET_SPEC_ROWS,
  BUILD_FILE,
  CLAIM_MAP_FILE,
  FONT_BUDGET_LIMITS,
  MEASURED_BUDGETS,
  SIZE_BUDGETS,
  SPEC_20_BUDGET_IDS,
  SPEC_FILE,
} from '../config.js';
import { planTaskIds } from '../lib/build-manifest.js';
import {
  checkClaimFigures,
  checkClaimMap,
  checkClaimQuotes,
  compareBudgetValues,
  thresholdOfCell,
  type BudgetRow,
  type ConfigThreshold,
} from '../lib/claims.js';
import { digestOf, PROJECTION_FILE, readProjection } from '../lib/projection.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * What the configuration enforces, as comparable quantities, one entry per budget id.
 *
 * THE HOME OF EVERY THRESHOLD IS `config.ts`, per the T034 amendment's recommendation: the one
 * of the three places where a number can be enforced. SPEC 20's table and the claim map are
 * references, and this list is what they are compared against, value for value, so a number
 * that moves in one place and not the others goes red instead of drifting for five tasks.
 */
export function configThresholds(): ConfigThreshold[] {
  const thresholds: ConfigThreshold[] = SIZE_BUDGETS.map((budget) => ({
    id: budget.id,
    threshold: { kind: 'bytes', value: budget.limitBytes },
  }));

  thresholds.push(
    {
      id: 'fonts-first-paint',
      threshold: { kind: 'bytes', value: FONT_BUDGET_LIMITS.firstPaintBytes },
    },
    { id: 'fonts-latin', threshold: { kind: 'bytes', value: FONT_BUDGET_LIMITS.latinBytes } },
    { id: 'fonts-total', threshold: { kind: 'bytes', value: FONT_BUDGET_LIMITS.totalBytes } },
  );

  for (const budget of MEASURED_BUDGETS) {
    if (budget.reportOnly === true) {
      thresholds.push({ id: budget.id, threshold: { kind: 'report' } });
      continue;
    }

    const parsed = thresholdOfCell(budget.limit);
    thresholds.push({
      id: budget.id,
      threshold: parsed ?? { kind: 'report' },
    });
  }

  return thresholds;
}

/**
 * Every SPEC 19 promise and every SPEC 20 number is answered by something that can go red.
 *
 * T015's definition of done is that claim, and this is what keeps it true after T015: the
 * claims are read out of `SPEC.md` rather than copied, the proofs are paths that have to exist,
 * and a claim nobody has reached yet names the task that owns it. The three ways a claim map
 * rots are all failures here: a claim added to the specification and not answered, a test
 * renamed out from under a row, and a row for a claim nobody makes any more.
 *
 * A TASK ID COUNTS WHETHER IT IS IN BUILD.md OR IN THE AMENDMENTS. `ai-docs/BUILD.md` cannot
 * gain a task without being regenerated, which is the maintainer's call, so scheduled work with
 * no task there lives under TASKS NOT YET IN BUILD.md in `ai-docs/BUILD-AMENDMENTS.md`. Both are
 * real owners; a claim owned by neither is a claim nobody will come back to.
 *
 * BOTH DOCUMENTS ARRIVE THROUGH THE COMMITTED PROJECTION, AND THE PROMISES ARRIVE AS DIGESTS.
 * SPEC 19 is a list of sentences and the claim map quotes each of them word for word, so the
 * comparison this gate makes is an equality between two texts, and an equality survives a digest
 * exactly while the words do not survive it at all. What that costs is the message: where a quote
 * has drifted, a clone can say which row drifted and not what it now says, and a reader opens the
 * two documents. What it buys is that the drift is caught at all, which before the artefact
 * happened on one machine.
 *
 * THE FIGURES SURVIVE AS FIGURES. A SPEC 20 threshold cell is a bound followed by paragraphs of
 * history, and only the bound is read, so only the bound ships. A claim map bounds cell is prose
 * carrying numbers, and only the numbers are read, so only the numbers ship.
 */
export const claimsGate: Gate = {
  id: 'claims',
  title: 'Every SPEC 19 and SPEC 20 claim is answered by a test that can fail',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];

    const read = readProjection(context.repoRoot);

    if (!read.ok) {
      return Promise.resolve({
        id: claimsGate.id,
        title: claimsGate.title,
        status: 'fail',
        findings: [{ level: 'error', message: `[projection-unreadable] ${read.reason}` }],
      });
    }

    const data = read.projection.data;
    const securityClaims = data.spec.securityClaims;
    const rows = data.claimMap;
    const projectedRows = data.spec.budgetRows;
    const build = data.build;
    const amendments = data.amendments;

    for (const [file, present] of [
      [SPEC_FILE, securityClaims !== null && projectedRows !== null],
      [CLAIM_MAP_FILE, rows !== null],
      [BUILD_FILE, build !== null],
    ] as const) {
      if (present) continue;

      findings.push({
        level: 'error',
        message: `${file} was not readable when ${PROJECTION_FILE} was generated, or the section this gate reads was not in it`,
      });
    }

    if (securityClaims === null || projectedRows === null || rows === null || build === null) {
      return Promise.resolve({
        id: claimsGate.id,
        title: claimsGate.title,
        status: 'fail',
        findings,
      });
    }

    // THE LABEL COMES BACK OUT OF THE CONFIGURATION AND NOT OUT OF THE ARTEFACT. `BUDGET_SPEC_ROWS`
    // already carries the row label each budget answers, word for word and committed, so a digest
    // that matches one of them can be printed as the words it stands for. A digest that matches
    // none is a row the configuration does not name, which is the failure being reported, and
    // there is nothing committed to print for it.
    const labels = new Map(
      Object.values(BUDGET_SPEC_ROWS).map((label) => [digestOf(label), label]),
    );
    const budgetRows: BudgetRow[] = projectedRows.map((row) => ({
      label: labels.get(row.label) ?? `${row.label} (a SPEC 20 row no budget names)`,
      threshold: row.threshold,
    }));

    const thresholds = configThresholds();

    const issues = checkClaimMap({
      securityClaims,
      budgetIds: SPEC_20_BUDGET_IDS,
      budgetRows,
      map: rows,
      taskIds: planTaskIds(build, amendments ?? ''),
      exists: (path) => existsSync(join(context.repoRoot, path)),
    });

    // VALUE AGAINST VALUE, per the T034 amendment: the count check above says the two lists
    // are the same length, and these two say they promise the same numbers. The table is
    // compared as a multiset because it has no ids; the map is compared by id because it does.
    issues.push(...compareBudgetValues(budgetRows, thresholds, BUDGET_SPEC_ROWS));
    issues.push(...checkClaimFigures(rows, thresholds));

    // AND THE PROMISE AGAINST THE PROMISE, since T042. Until then the text of a SPEC 19 claim was
    // parsed on every run and compared with nothing: the map answered by id, and the id is the
    // promise's ordinal in a numbered list, so a rewritten promise and a reordered list both left
    // this gate green. Each row now carries the promise it answers, word for word.
    issues.push(...checkClaimQuotes(securityClaims, rows));

    for (const issue of issues) {
      findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
    }

    if (issues.length === 0) {
      const proved = rows.filter((row) => row.status === 'proved');
      const scheduled = rows.filter((row) => row.status !== 'proved');

      findings.push({
        level: 'info',
        message:
          `${String(securityClaims.length)} SPEC 19 claim(s) and ${String(SPEC_20_BUDGET_IDS.length)} ` +
          `SPEC 20 budget(s) answered by ${String(rows.length)} row(s): ${String(proved.length)} proved, ` +
          `${String(scheduled.length)} owned by a task, and every SPEC 19 row quotes the promise ` +
          'it answers as the specification writes it',
      });

      for (const row of scheduled) {
        findings.push({ level: 'info', message: `${row.id} is owned by ${row.status}` });
      }
    }

    return Promise.resolve({
      id: claimsGate.id,
      title: claimsGate.title,
      status: issues.length === 0 ? 'pass' : 'fail',
      findings,
    });
  },
};
